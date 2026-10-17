import * as core from "@actions/core";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { isWorkflowError, WorkflowError } from "./errors.js";
import {
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  selectAutofixScripts,
  type JsInstallationPlan,
} from "./javascript-env.js";
import {
  detectPythonPackageManager,
  isExecutableAvailable,
  type PythonPackageManagerInfo,
} from "./python-env.js";
import { sanitizeCause, sanitizeCommandString } from "./sanitize.js";

export { sanitizePackageManager };

/**
 * Executes a shell command synchronously while capturing and sanitizing stdout and stderr.
 * Output lines are passed through `sanitizeCommandString()` before writing to `process.stdout`/`process.stderr`.
 *
 * Limitation note: Binary or non-UTF8 output chunks without newline boundaries might be partially sanitized per line,
 * but line-buffered UTF-8 text (standard for log output) is fully sanitized.
 */
function execSanitized(
  cmd: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const cwd = options.cwd || process.cwd();
  const res = spawnSync(cmd, {
    cwd,
    env: options.env || process.env,
    shell: true,
    encoding: "utf8",
  });

  const stdout = res.stdout || "";
  const stderr = res.stderr || "";

  if (stdout) {
    const sanitizedStdout = sanitizeCommandString(stdout);
    process.stdout.write(sanitizedStdout);
  }

  if (stderr) {
    const sanitizedStderr = sanitizeCommandString(stderr);
    process.stderr.write(sanitizedStderr);
  }

  return {
    status: res.status,
    stdout,
    stderr,
    error: res.error,
  };
}

function runScriptCommand(pm: string, name: string, cwd: string = process.cwd()): void {
  const safePm = sanitizePackageManager(pm);
  const rawCmd = `${safePm} run ${name}`;
  const displayCmd = sanitizeCommandString(rawCmd);
  core.info(`Executing: ${displayCmd}`);

  const result = execSanitized(rawCmd, { cwd });
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

function runJsInstallationPlan(plan: JsInstallationPlan, cwd: string = process.cwd()): void {
  const fullCmd = `${plan.command} ${plan.args.join(" ")}`.trim();
  const displayCmd = sanitizeCommandString(fullCmd);
  core.info(`Installing JS dependencies: ${displayCmd}`);

  const result = execSanitized(fullCmd, { cwd });
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

function executeJsScripts(
  scripts: Record<string, string>,
  pm: string,
  cwd: string = process.cwd(),
): void {
  const selected = selectAutofixScripts(scripts);
  for (const scriptName of selected) {
    runScriptCommand(pm, scriptName, cwd);
  }
}

export function executeJsWorkflow(cwd: string = process.cwd()): void {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return;
  }

  if (jsEnv.packageJsonError) {
    const sanitizedMsg = sanitizeCommandString(jsEnv.packageJsonError);
    throw new WorkflowError("INVALID_INPUT", sanitizedMsg, {
      stage: "js-project-inspection",
      cwd,
      cause: sanitizeCause(jsEnv.packageJsonErrorCause),
    });
  }

  const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(jsEnv).name;
  const pm = sanitizePackageManager(rawPm);

  const plan = getJsInstallationPlan(jsEnv, pm);
  runJsInstallationPlan(plan, cwd);

  const scripts = jsEnv.packageJson?.scripts || {};
  const selectedScripts = selectAutofixScripts(scripts);

  if (selectedScripts.length === 0) {
    core.info("No matching scripts (check, format, lint, etc.) found in package.json.");
    return;
  }

  executeJsScripts(scripts, pm, cwd);
}

function runPythonCommand(cmd: string, pmName: string, cwd: string = process.cwd()): void {
  const displayCmd = sanitizeCommandString(cmd);
  core.info(`Executing: ${displayCmd}`);
  const result = execSanitized(cmd, { cwd });
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

export function executePythonWorkflow(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
): void {
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
      runPythonCommand(installCmd, pmInfo.name, cwd);
    }
  }
}

export function run(cwd: string = process.cwd()): void {
  try {
    executeJsWorkflow(cwd);

    const pythonPmInfo = detectPythonPackageManager(cwd);
    if (pythonPmInfo) {
      executePythonWorkflow(pythonPmInfo, cwd);
    }
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
  run();
}
