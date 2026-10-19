import * as core from "@actions/core";
import * as exec from "@actions/exec";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { isWorkflowError, WorkflowError } from "../errors.js";
import {
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  selectAutofixScripts,
  type JsInstallationPlan,
} from "../javascript-env.js";
import { isExecutableAvailable } from "../process-utils.js";
import {
  detectPythonPackageManager,
  hasPythonSource,
  type PythonPackageManagerInfo,
} from "../python-env.js";
import { sanitizeCause, sanitizeCommandString } from "../sanitize.js";

export { sanitizePackageManager };

/**
 * Executes a shell command synchronously while capturing and sanitizing stdout and stderr.
 * Output lines are passed through `sanitizeCommandString()` before writing to `process.stdout`/`process.stderr`.
 *
 * Limitation note: Binary or non-UTF8 output chunks without newline boundaries might be partially sanitized per line,
 * but line-buffered UTF-8 text (standard for log output) is fully sanitized.
 */
async function execSanitized(
  executable: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }> {
  const cwd = options.cwd || process.cwd();
  let stdout = "";
  let stderr = "";
  let status: number | null = null;
  let error: Error | undefined;

  try {
    status = await exec.exec(executable, args, {
      cwd,
      env: (options.env || process.env) as Record<string, string>,
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString("utf8");
        },
        stderr: (data: Buffer) => {
          stderr += data.toString("utf8");
        },
      },
    });
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  if (stdout) {
    const sanitizedStdout = sanitizeCommandString(stdout);
    process.stdout.write(sanitizedStdout);
  }

  if (stderr) {
    const sanitizedStderr = sanitizeCommandString(stderr);
    process.stderr.write(sanitizedStderr);
  }

  return {
    status,
    stdout,
    stderr,
    error,
  };
}

async function runScriptCommand(pm: string, name: string, cwd: string = process.cwd()): Promise<void> {
  const safePm = sanitizePackageManager(pm);
  const rawCmd = `${safePm} run ${name}`;
  const displayCmd = sanitizeCommandString(rawCmd);
  core.info(`Executing: ${displayCmd}`);

  const result = await execSanitized(safePm, ["run", name], { cwd });
  if (result.status !== 0 || result.error) {
    core.error(`Script "${name}" failed`);
    const message = `Script "${name}" failed while executing "${displayCmd}".`;
    const causeObj =
      result.error ||
      new Error(sanitizeCommandString(result.stderr || `Exit code ${result.status}`));
    throw new WorkflowError("COMMAND_EXECUTION_FAILURE", message, {
      stage: "js-script-execution",
      script: name,
      packageManager: safePm,
      command: displayCmd,
      cwd,
      cause: sanitizeCause(causeObj),
    });
  }
}

async function runJsInstallationPlan(plan: JsInstallationPlan, cwd: string = process.cwd()): Promise<void> {
  const fullCmd = `${plan.command} ${plan.args.join(" ")}`.trim();
  const displayCmd = sanitizeCommandString(fullCmd);
  core.info(`Installing JS dependencies: ${displayCmd}`);

  const result = await execSanitized(plan.command, plan.args, { cwd });
  if (result.status !== 0 || result.error) {
    core.error(`JS dependency installation failed: ${displayCmd}`);
    const message = `JS dependency installation failed executing "${displayCmd}". Check dependency constraints or lockfile compatibility.`;
    const causeObj =
      result.error ||
      new Error(sanitizeCommandString(result.stderr || `Exit code ${result.status}`));
    throw new WorkflowError("SETUP_FAILURE", message, {
      stage: "js-dependency-installation",
      packageManager: plan.packageManager,
      command: displayCmd,
      cwd,
      cause: sanitizeCause(causeObj),
    });
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
    const code = jsEnv.packageJsonErrorType === "parse" ? "INVALID_INPUT" : "SETUP_FAILURE";
    const sanitizedMsg = sanitizeCommandString(jsEnv.packageJsonError);
    throw new WorkflowError(code, sanitizedMsg, {
      stage: "js-project-inspection",
      cwd,
      cause: sanitizeCause(jsEnv.packageJsonErrorCause),
    });
  }

  const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(jsEnv).name;
  const pm = sanitizePackageManager(rawPm);

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

function resolvePythonInstallCommands(
  installCommand: string,
): Array<{ executable: string; args: string[] }> {
  const trimmed = installCommand.trim();
  if (!trimmed) return [];

  if (trimmed === "pip install -r requirements.txt && pip install -e .") {
    return [
      { executable: "pip", args: ["install", "-r", "requirements.txt"] },
      { executable: "pip", args: ["install", "-e", "."] },
    ];
  }
  if (trimmed === "pip install -r requirements.txt") {
    return [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }];
  }
  if (trimmed === "pip install -e .") {
    return [{ executable: "pip", args: ["install", "-e", "."] }];
  }
  if (trimmed === "uv sync") {
    return [{ executable: "uv", args: ["sync"] }];
  }
  if (trimmed === "uv pip install -r requirements.txt") {
    return [{ executable: "uv", args: ["pip", "install", "-r", "requirements.txt"] }];
  }

  const parts = trimmed.split(/\s+/);
  return [{ executable: parts[0], args: parts.slice(1) }];
}

async function runPythonCommand(
  executable: string,
  args: string[],
  pmName: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const rawCmd = `${executable} ${args.join(" ")}`.trim();
  const displayCmd = sanitizeCommandString(rawCmd);
  core.info(`Executing: ${displayCmd}`);
  const result = await execSanitized(executable, args, { cwd });
  if (result.status !== 0 || result.error) {
    core.error(`Python command "${displayCmd}" failed`);
    const message = `Python command "${displayCmd}" failed. Check Python environment and dependency configuration.`;
    const causeObj =
      result.error ||
      new Error(sanitizeCommandString(result.stderr || `Exit code ${result.status}`));
    throw new WorkflowError("SETUP_FAILURE", message, {
      stage: "python-dependency-installation",
      packageManager: pmName,
      command: displayCmd,
      cwd,
      cause: sanitizeCause(causeObj),
    });
  }
}

export async function executePythonWorkflow(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
): Promise<void> {
  core.info(`Detected Python package manager: ${pmInfo.name}`);

  const requiredBin = pmInfo.name === "pip" ? "pip" : pmInfo.name;
  const hasPmBin = isExecutableAvailable(requiredBin);

  if (!hasPmBin && !pmInfo.isStandalone) {
    const message = `Required Python package manager '${requiredBin}' is not available in PATH.`;
    core.error(message);
    throw new WorkflowError("MISSING_CONFIGURATION", message, {
      stage: "python-environment-check",
      packageManager: pmInfo.name,
      requiredBinary: requiredBin,
    });
  }

  if (!pmInfo.isStandalone) {
    const installCmd = pmInfo.installCommand;
    if (installCmd) {
      core.info(`Installing Python dependencies: ${sanitizeCommandString(installCmd)}`);
      const subCmds = resolvePythonInstallCommands(installCmd);
      for (const { executable, args } of subCmds) {
        await runPythonCommand(executable, args, pmInfo.name, cwd);
      }
    }
  }
}

export async function executeRuffAutofix(cwd: string = process.cwd()): Promise<void> {
  if (!hasPythonSource(cwd)) {
    return;
  }

  if (!isExecutableAvailable("ruff")) {
    const message = "Required Python binary 'ruff' is not available in PATH.";
    core.error(message);
    throw new WorkflowError("MISSING_CONFIGURATION", message, {
      stage: "python-environment-check",
      requiredBinary: "ruff",
      cwd,
    });
  }

  const ruffCommandSpecs = [
    { executable: "ruff", args: ["check", "--fix", "."] },
    { executable: "ruff", args: ["format", "."] },
  ];

  for (const { executable, args } of ruffCommandSpecs) {
    const displayCmd = sanitizeCommandString(`${executable} ${args.join(" ")}`);
    core.info(`Executing: ${displayCmd}`);
    const result = await execSanitized(executable, args, { cwd });
    if (result.status !== 0 || result.error) {
      core.error(`Ruff command "${displayCmd}" failed`);
      const message = `Ruff command "${displayCmd}" failed. Check Python and Ruff configuration.`;
      const causeObj =
        result.error ||
        new Error(sanitizeCommandString(result.stderr || `Exit code ${result.status}`));
      throw new WorkflowError("COMMAND_EXECUTION_FAILURE", message, {
        stage: "ruff-autofix-execution",
        command: displayCmd,
        cwd,
        cause: sanitizeCause(causeObj),
      });
    }
  }
}

export async function run(cwd: string = process.cwd()): Promise<void> {
  try {
    await executeJsWorkflow(cwd);

    const pythonPmInfo = detectPythonPackageManager(cwd);
    if (pythonPmInfo) {
      await executePythonWorkflow(pythonPmInfo, cwd);
    }

    await executeRuffAutofix(cwd);
  } catch (error) {
    if (isWorkflowError(error)) {
      core.setFailed(error);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const wfError = new WorkflowError(
        "COMMAND_EXECUTION_FAILURE",
        `Failed to run scripts: ${sanitizeCommandString(message)}`,
        { stage: "autofix-execution", cwd, cause: sanitizeCause(error) },
      );
      core.setFailed(wfError);
    }
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
