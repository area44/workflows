import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";

import type { ProjectContext } from "./types.js";

import {
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  type JsInstallationPlan,
  type SupportedPackageManager,
} from "../javascript-env.js";
import {
  detectPythonPackageManager,
  findPythonProjectContext,
  hasPythonSource,
  validatePythonPmInfoStructure,
  type PythonPackageManagerInfo,
  type PythonProjectContext,
} from "../python-env.js";
import { isMainModule } from "../utils/is-main-module.js";
import { ExecutionEngine } from "./engine.js";
import { planExecution } from "./planner.js";
import { defaultRegistry } from "./registry.js";

export { sanitizePackageManager };

async function runJsInstallationPlan(
  plan: JsInstallationPlan,
  cwd: string = process.cwd(),
): Promise<void> {
  const displayCmd = `${plan.command} ${plan.args.join(" ")}`.trim();
  core.info(`Installing JS dependencies: ${displayCmd}`);

  const exitCode = await exec.exec(plan.command, plan.args, { cwd, ignoreReturnCode: true });
  if (exitCode !== 0) {
    throw new Error(
      `JS dependency installation failed executing "${displayCmd}". Check dependency constraints or lockfile compatibility.`,
    );
  }
}

export async function executeJsWorkflow(cwd: string = process.cwd()): Promise<void> {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return;
  }

  if (jsEnv.packageJsonError) {
    throw new Error(jsEnv.packageJsonError);
  }

  const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(jsEnv).name;
  const pm = sanitizePackageManager(rawPm) as SupportedPackageManager;

  const context: ProjectContext = {
    cwd,
    jsEnv,
    jsPm: pm,
    hasPythonSource: false,
  };

  const plan = await planExecution(defaultRegistry, context, "fix");
  const jsTasks = plan.tasks.filter((t) => t.toolId !== "ruff");

  if (jsTasks.length === 0) {
    core.info("No matching scripts (fix, format, lint, check, etc.) found in package.json.");
    return;
  }

  const installPlan = getJsInstallationPlan(pm);
  await runJsInstallationPlan(installPlan, cwd);

  const engine = new ExecutionEngine();
  const results = await engine.executeTasks(jsTasks);
  const failures = results.filter((r) => r.error);
  if (failures.length > 0) {
    const errorMessages = failures.map((f) => f.error?.message || `Task ${f.task.id} failed`);
    throw new Error(errorMessages.join("\n"));
  }
}

async function runPythonCommand(
  executable: string,
  args: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  const displayCmd = `${executable} ${args.join(" ")}`.trim();
  core.info(`Executing: ${displayCmd}`);
  const exitCode = await exec.exec(executable, args, { cwd, ignoreReturnCode: true });
  if (exitCode !== 0) {
    throw new Error(
      `Python command "${displayCmd}" failed. Check Python environment and dependency configuration.`,
    );
  }
}

export async function executePythonWorkflow(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
): Promise<void> {
  validatePythonPmInfoStructure(pmInfo, 'Invalid Python environment: "pmInfo" must be an object');

  const requiredBin = pmInfo.name === "pip" ? "pip" : pmInfo.name;
  const hasPmBin = Boolean(await io.which(requiredBin, false));

  if (!hasPmBin && !pmInfo.isStandalone) {
    const message = `Required Python package manager '${requiredBin}' is not available in PATH.`;
    throw new Error(message);
  }

  if (!pmInfo.isStandalone && pmInfo.installCommands.length > 0) {
    const installCmds = pmInfo.installCommands;
    const displayCmd = installCmds.map((c) => `${c.executable} ${c.args.join(" ")}`).join(" && ");
    core.info(`Installing Python dependencies: ${displayCmd}`);
    for (const { executable, args } of installCmds) {
      await runPythonCommand(executable, args, cwd);
    }
  }
}

export async function executeRuffAutofix(
  cwd: string = process.cwd(),
  hasSource?: boolean,
): Promise<void> {
  const hasSourceCode = hasSource ?? hasPythonSource(cwd);
  if (!hasSourceCode) {
    return;
  }

  const hasRuff = Boolean(await io.which("ruff", false));
  if (!hasRuff) {
    const message = "Required Python binary 'ruff' is not available in PATH.";
    throw new Error(message);
  }

  const context: ProjectContext = {
    cwd,
    hasPythonSource: true,
  };

  const ruffProvider = defaultRegistry.getProvider("python");
  const ruffAdapter = ruffProvider?.getAdapters(context).find((a) => a.id === "ruff");
  if (!ruffAdapter) {
    throw new Error("Ruff adapter not found in registry.");
  }

  const tasks = await ruffAdapter.plan(context, "fix");
  const engine = new ExecutionEngine();
  const results = await engine.executeTasks(tasks);
  const failures = results.filter((r) => r.error);
  if (failures.length > 0) {
    const errorMessages = failures.map((f) => f.error?.message || `Task ${f.task.id} failed`);
    throw new Error(errorMessages.join("\n"));
  }
}

async function runJsWorkflowStep(cwd: string): Promise<Error | null> {
  const jsSetupFailed =
    process.env.JS_SETUP_OUTCOME === "failure" ||
    process.env.NODE_SETUP_OUTCOME === "failure" ||
    process.env.BUN_SETUP_OUTCOME === "failure" ||
    process.env.PNPM_SETUP_OUTCOME === "failure";

  if (jsSetupFailed) {
    return new Error("JavaScript runtime or package manager setup failed.");
  }

  try {
    await executeJsWorkflow(cwd);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function runPythonDepsStep(
  cwd: string,
  precomputed?: {
    ctx?: PythonProjectContext;
    hasSource?: boolean;
    pmInfo?: PythonPackageManagerInfo | null;
  },
): Promise<Error | null> {
  const pythonEnvSetupFailed =
    process.env.PYTHON_SETUP_OUTCOME === "failure" ||
    process.env.UV_SETUP_OUTCOME === "failure" ||
    process.env.PY_SETUP_OUTCOME === "failure";

  if (pythonEnvSetupFailed) {
    return new Error("Python runtime or package manager setup failed.");
  }

  const pythonPmInfo =
    precomputed && "pmInfo" in precomputed
      ? precomputed.pmInfo
      : detectPythonPackageManager(cwd, undefined, {
          ctx: precomputed?.ctx,
          hasSource: precomputed?.hasSource,
        });

  if (!pythonPmInfo) {
    return null;
  }

  try {
    await executePythonWorkflow(pythonPmInfo, cwd);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function runRuffStep(cwd: string, hasSource?: boolean): Promise<Error | null> {
  const ruffSetupFailed = process.env.RUFF_SETUP_OUTCOME === "failure";

  if (ruffSetupFailed) {
    return new Error("Ruff setup failed.");
  }

  try {
    await executeRuffAutofix(cwd, hasSource);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function runPythonWorkflowStep(cwd: string, hasSource?: boolean): Promise<Error[]> {
  const hasSourceCode = hasSource ?? hasPythonSource(cwd);
  if (!hasSourceCode) {
    return [];
  }

  const errors: Error[] = [];

  const ctx = findPythonProjectContext(cwd);
  const pmInfo = detectPythonPackageManager(cwd, undefined, {
    ctx,
    hasSource: true,
    isProject: true,
  });

  const depsErr = await runPythonDepsStep(cwd, { ctx, hasSource: true, pmInfo });
  if (depsErr) {
    errors.push(depsErr);
  }

  const ruffErr = await runRuffStep(cwd, hasSourceCode);
  if (ruffErr) {
    errors.push(ruffErr);
  }

  return errors;
}

export async function run(cwd: string = process.cwd()): Promise<void> {
  const hasSource = hasPythonSource(cwd);

  // Emit explainable execution plan summary before execution
  try {
    const jsEnv = inspectJsProjectEnvironment(cwd);
    const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(jsEnv).name;
    const pm = sanitizePackageManager(rawPm) as SupportedPackageManager;

    const fullContext: ProjectContext = {
      cwd,
      jsEnv,
      jsPm: pm,
      hasPythonSource: hasSource,
    };
    const overallPlan = await planExecution(defaultRegistry, fullContext, "fix");
    core.info(overallPlan.summary);
  } catch {
    // Planning summary logging is best-effort and should not halt execution
  }

  const errors: Error[] = [];

  const jsErr = await runJsWorkflowStep(cwd);
  if (jsErr) {
    errors.push(jsErr);
  }

  const pythonErrs = await runPythonWorkflowStep(cwd, hasSource);
  errors.push(...pythonErrs);

  if (errors.length > 0) {
    const combinedMessage = errors.map((e) => e.message).join("\n");
    core.setFailed(`Failed to run scripts: ${combinedMessage}`);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  void run();
}
