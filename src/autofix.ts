import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

export { sanitizePackageManager };

function runScriptCommand(pm: string, name: string): void {
  const safePm = sanitizePackageManager(pm);
  core.info(`Executing: ${safePm} run ${name}`);
  try {
    execSync(`${safePm} run ${name}`, { stdio: "inherit" });
  } catch {
    core.error(`Script "${name}" failed`);
    process.exit(1);
  }
}

function runJsInstallationPlan(plan: JsInstallationPlan): void {
  const fullCmd = `${plan.command} ${plan.args.join(" ")}`.trim();
  core.info(`Installing JS dependencies: ${fullCmd}`);
  try {
    execSync(fullCmd, { stdio: "inherit" });
  } catch {
    core.error(`JS dependency installation failed: ${fullCmd}`);
    process.exit(1);
  }
}

function executeJsScripts(scripts: Record<string, string>, pm: string): void {
  const selected = selectAutofixScripts(scripts);

  if (scripts.check) {
    runScriptCommand(pm, "check");
    core.info("Detected and executed script: check");
  } else if (scripts.format && scripts.lint) {
    core.info("Detected lint/format scripts: format, lint");
    runScriptCommand(pm, "format");
    runScriptCommand(pm, "lint");
  } else if (scripts.fmt && scripts.lint) {
    core.info("Detected lint/format scripts: fmt, lint");
    runScriptCommand(pm, "fmt");
    runScriptCommand(pm, "lint");
  } else if (selected.length > 0) {
    for (const scriptName of selected) {
      runScriptCommand(pm, scriptName);
    }
  }
}

export function executeJsWorkflow(cwd: string = process.cwd()): void {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return;
  }

  if (jsEnv.packageJsonError) {
    throw new Error(jsEnv.packageJsonError);
  }

  const scripts = jsEnv.packageJson?.scripts || {};
  const selectedScripts = selectAutofixScripts(scripts);

  if (selectedScripts.length === 0) {
    core.info("No matching scripts (check, format, lint, etc.) found in package.json.");
    return;
  }

  const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(jsEnv).name;
  const pm = sanitizePackageManager(rawPm);

  if (process.env.SKIP_JS_INSTALL !== "true") {
    const plan = getJsInstallationPlan(jsEnv, pm);
    runJsInstallationPlan(plan);
  }

  executeJsScripts(scripts, pm);
}

function runPythonCommand(cmd: string): void {
  core.info(`Executing: ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    core.error(`Python command "${cmd}" failed`);
    process.exit(1);
  }
}

export function executePythonWorkflow(pmInfo: PythonPackageManagerInfo): void {
  core.info(`Detected Python package manager: ${pmInfo.name}`);

  const requiredBin = pmInfo.name === "pip" ? "pip" : pmInfo.name;
  const hasPmBin = isExecutableAvailable(requiredBin);

  if (!hasPmBin && !pmInfo.isStandalone) {
    core.error(`Required Python package manager '${requiredBin}' is not available in PATH.`);
    process.exit(1);
  }

  if (!pmInfo.isStandalone && process.env.SKIP_PYTHON_INSTALL !== "true") {
    const installCmd = pmInfo.installCommand;
    if (installCmd) {
      core.info(`Installing Python dependencies: ${installCmd}`);
      runPythonCommand(installCmd);
    }
  }
}

export function run(cwd: string = process.cwd()): void {
  try {
    executeJsWorkflow(cwd);

    const pythonPmInfo = detectPythonPackageManager(cwd);
    if (pythonPmInfo) {
      executePythonWorkflow(pythonPmInfo);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
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
