import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  selectAutofixScripts,
  type JsInstallationPlan,
} from "../javascript-env.js";
import {
  detectPythonPackageManager,
  hasPythonSource,
  type PythonInstallCommand,
  type PythonPackageManagerInfo,
} from "../python-env.js";

export { sanitizePackageManager };

async function runScriptCommand(
  pm: string,
  name: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const safePm = sanitizePackageManager(pm);
  const displayCmd = `${safePm} run ${name}`;
  core.info(`Executing: ${displayCmd}`);

  const exitCode = await exec.exec(safePm, ["run", name], { cwd, ignoreReturnCode: true });
  if (exitCode !== 0) {
    core.error(`Script "${name}" failed`);
    throw new Error(`Script "${name}" failed while executing "${displayCmd}".`);
  }
}

async function runJsInstallationPlan(
  plan: JsInstallationPlan,
  cwd: string = process.cwd(),
): Promise<void> {
  const displayCmd = `${plan.command} ${plan.args.join(" ")}`.trim();
  core.info(`Installing JS dependencies: ${displayCmd}`);

  const exitCode = await exec.exec(plan.command, plan.args, { cwd, ignoreReturnCode: true });
  if (exitCode !== 0) {
    core.error(`JS dependency installation failed: ${displayCmd}`);
    throw new Error(
      `JS dependency installation failed executing "${displayCmd}". Check dependency constraints or lockfile compatibility.`,
    );
  }
}

async function executeJsScripts(
  scripts: Record<string, string>,
  pm: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const selected = selectAutofixScripts(scripts);
  for (const scriptName of selected) {
    await runScriptCommand(pm, scriptName, cwd);
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
  const pm = sanitizePackageManager(rawPm);

  const hasPmBin = Boolean(await io.which(pm, false));
  if (!hasPmBin) {
    const message = `Required JavaScript package manager '${pm}' is not available in PATH.`;
    core.error(message);
    throw new Error(message);
  }

  const plan = getJsInstallationPlan(jsEnv, pm);
  await runJsInstallationPlan(plan, cwd);

  const scripts = jsEnv.packageJson?.scripts || {};
  const selectedScripts = selectAutofixScripts(scripts);

  if (selectedScripts.length === 0) {
    core.info("No matching scripts (check, format, lint, etc.) found in package.json.");
    return;
  }

  await executeJsScripts(scripts, pm, cwd);
}

function resolvePythonInstallCommands(pmInfo: PythonPackageManagerInfo): PythonInstallCommand[] {
  if (pmInfo.installCommands && pmInfo.installCommands.length > 0) {
    return pmInfo.installCommands;
  }

  const rawCmd = (pmInfo.installCommand || "").trim();
  if (!rawCmd) return [];

  if (rawCmd === "pip install -r requirements.txt && pip install -e .") {
    return [
      { executable: "pip", args: ["install", "-r", "requirements.txt"] },
      { executable: "pip", args: ["install", "-e", "."] },
    ];
  }
  if (rawCmd === "pip install -r requirements.txt") {
    return [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }];
  }
  if (rawCmd === "pip install -e .") {
    return [{ executable: "pip", args: ["install", "-e", "."] }];
  }
  if (rawCmd === "uv sync") {
    return [{ executable: "uv", args: ["sync"] }];
  }
  if (rawCmd === "uv pip install -r requirements.txt") {
    return [{ executable: "uv", args: ["pip", "install", "-r", "requirements.txt"] }];
  }

  throw new Error(`Unsupported or malformed Python install command configuration: "${rawCmd}".`);
}

async function runPythonCommand(
  executable: string,
  args: string[],
  _pmName: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const displayCmd = `${executable} ${args.join(" ")}`.trim();
  core.info(`Executing: ${displayCmd}`);
  const exitCode = await exec.exec(executable, args, { cwd, ignoreReturnCode: true });
  if (exitCode !== 0) {
    core.error(`Python command "${displayCmd}" failed`);
    throw new Error(
      `Python command "${displayCmd}" failed. Check Python environment and dependency configuration.`,
    );
  }
}

export async function executePythonWorkflow(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
): Promise<void> {
  core.info(`Detected Python package manager: ${pmInfo.name}`);

  const requiredBin = pmInfo.name === "pip" ? "pip" : pmInfo.name;
  const hasPmBin = Boolean(await io.which(requiredBin, false));

  if (!hasPmBin && !pmInfo.isStandalone) {
    const message = `Required Python package manager '${requiredBin}' is not available in PATH.`;
    core.error(message);
    throw new Error(message);
  }

  if (!pmInfo.isStandalone) {
    const installCmds = resolvePythonInstallCommands(pmInfo);
    if (installCmds.length > 0) {
      const displayCmd =
        pmInfo.installCommand ||
        installCmds.map((c) => `${c.executable} ${c.args.join(" ")}`).join(" && ");
      core.info(`Installing Python dependencies: ${displayCmd}`);
      for (const { executable, args } of installCmds) {
        await runPythonCommand(executable, args, pmInfo.name, cwd);
      }
    }
  }
}

export async function executeRuffAutofix(cwd: string = process.cwd()): Promise<void> {
  if (!hasPythonSource(cwd)) {
    return;
  }

  const hasRuff = Boolean(await io.which("ruff", false));
  if (!hasRuff) {
    const message = "Required Python binary 'ruff' is not available in PATH.";
    core.error(message);
    throw new Error(message);
  }

  const ruffCommandSpecs = [
    { executable: "ruff", args: ["check", "--fix", "."] },
    { executable: "ruff", args: ["format", "."] },
  ];

  for (const { executable, args } of ruffCommandSpecs) {
    const displayCmd = `${executable} ${args.join(" ")}`;
    core.info(`Executing: ${displayCmd}`);
    const exitCode = await exec.exec(executable, args, { cwd, ignoreReturnCode: true });
    if (exitCode !== 0) {
      core.error(`Ruff command "${displayCmd}" failed`);
      throw new Error(`Ruff command "${displayCmd}" failed. Check Python and Ruff configuration.`);
    }
  }
}

async function runJsWorkflowStep(cwd: string): Promise<Error | null> {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return null;
  }

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

async function runPythonDepsStep(cwd: string): Promise<Error | null> {
  const pythonEnvSetupFailed =
    process.env.PYTHON_SETUP_OUTCOME === "failure" ||
    process.env.UV_SETUP_OUTCOME === "failure" ||
    process.env.PY_SETUP_OUTCOME === "failure";

  if (pythonEnvSetupFailed) {
    return new Error("Python runtime or package manager setup failed.");
  }

  const pythonPmInfo = detectPythonPackageManager(cwd);
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

async function runRuffStep(cwd: string): Promise<Error | null> {
  const ruffSetupFailed = process.env.RUFF_SETUP_OUTCOME === "failure";

  if (ruffSetupFailed) {
    return new Error("Ruff setup failed.");
  }

  try {
    await executeRuffAutofix(cwd);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function runPythonWorkflowStep(cwd: string): Promise<Error[]> {
  if (!hasPythonSource(cwd)) {
    return [];
  }

  const errors: Error[] = [];

  const depsErr = await runPythonDepsStep(cwd);
  if (depsErr) {
    errors.push(depsErr);
  }

  const ruffErr = await runRuffStep(cwd);
  if (ruffErr) {
    errors.push(ruffErr);
  }

  return errors;
}

export async function run(cwd: string = process.cwd()): Promise<void> {
  const errors: Error[] = [];

  const jsErr = await runJsWorkflowStep(cwd);
  if (jsErr) {
    errors.push(jsErr);
  }

  const pythonErrs = await runPythonWorkflowStep(cwd);
  errors.push(...pythonErrs);

  if (errors.length > 0) {
    const combinedMessage = errors.map((e) => e.message).join("\n");
    core.setFailed(`Failed to run scripts: ${combinedMessage}`);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
  }
}

function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  void run();
}
