import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isSupportedRuntime,
  resolveJsEnvironment,
  validateRuntimePackageManagerCompatibility,
  type ResolvedJavaScriptEnvironment,
} from "./javascript-env.js";
import {
  resolvePythonEnvironment,
  resolvePythonSetupVersion,
  resolveRuffSetupVersion,
  isExactVersion,
  type ResolvedPythonEnvironment,
} from "./python-env.js";
import {
  createSetupPlan,
  resolvePnpmSetupRuntime,
  type BunSetupPlan,
  type NodeSetupPlan,
  type PnpmSetupPlan,
  type SetupPlan,
} from "./setup-plan.js";

export type {
  ResolvedJavaScriptEnvironment,
  ResolvedPythonEnvironment,
  NodeSetupPlan,
  BunSetupPlan,
  PnpmSetupPlan,
  SetupPlan,
};

export { resolveJsEnvironment, resolvePythonEnvironment, resolvePnpmSetupRuntime, createSetupPlan };

export interface ResolvedEnvironment {
  javascript: ResolvedJavaScriptEnvironment;
  python: ResolvedPythonEnvironment;
}

function validateJsEnvironment(js: unknown): void {
  if (!js || typeof js !== "object") {
    throw new Error('Invalid environment: missing or invalid "javascript" section');
  }

  const jsObj = js as Record<string, unknown>;

  if (typeof jsObj.detected !== "boolean") {
    throw new Error('Invalid JavaScript environment: "detected" must be a boolean');
  }

  const runtimeObj = jsObj.runtime as Record<string, unknown> | undefined;
  if (!runtimeObj || typeof runtimeObj !== "object") {
    throw new Error('Invalid JavaScript environment: "runtime" must be an object');
  }

  const runtimeName = runtimeObj.name;
  if (typeof runtimeName !== "string" || !isSupportedRuntime(runtimeName)) {
    throw new Error(`Invalid resolved runtime: "${String(runtimeName)}"`);
  }

  if (typeof runtimeObj.version !== "string") {
    throw new Error('Invalid JavaScript environment: "runtime.version" must be a string');
  }

  const pmObj = jsObj.packageManager as Record<string, unknown> | undefined;
  if (
    !pmObj ||
    typeof pmObj !== "object" ||
    typeof pmObj.name !== "string" ||
    typeof pmObj.version !== "string" ||
    !pmObj.name ||
    !pmObj.version
  ) {
    throw new Error("Invalid resolved package manager");
  }

  if (jsObj.toolchain !== undefined && jsObj.toolchain !== "vite-plus") {
    const val =
      typeof jsObj.toolchain === "string" ? jsObj.toolchain : JSON.stringify(jsObj.toolchain);
    throw new Error(`Invalid resolved toolchain: "${val}"`);
  }

  validateRuntimePackageManagerCompatibility(runtimeName, pmObj.name);
}

function validateInstallCommandItem(cmd: unknown): void {
  if (!cmd || typeof cmd !== "object") {
    throw new Error('Invalid Python environment: malformed "installCommands" item');
  }
  const item = cmd as Record<string, unknown>;
  if (
    typeof item.executable !== "string" ||
    !item.executable.trim() ||
    !Array.isArray(item.args) ||
    !item.args.every((a: unknown) => typeof a === "string")
  ) {
    throw new Error('Invalid Python environment: malformed "installCommands" item');
  }
}

function validateInstallCommands(commands: unknown): void {
  if (!Array.isArray(commands)) {
    throw new Error('Invalid Python environment: "pmInfo.installCommands" must be an array');
  }
  for (const cmd of commands) {
    validateInstallCommandItem(cmd);
  }
}

function validatePmInfoFields(pmObj: Record<string, unknown>): void {
  if (pmObj.name !== "uv" && pmObj.name !== "pip") {
    throw new Error(`Invalid Python environment: pmInfo name must be "uv" or "pip"`);
  }
  if (typeof pmObj.execPrefix !== "string") {
    throw new Error('Invalid Python environment: "pmInfo.execPrefix" must be a string');
  }
  const optionalStrings = [
    "version",
    "versionSource",
    "lockfile",
    "configFile",
    "lockCommand",
    "syncCommand",
  ];
  for (const field of optionalStrings) {
    if (pmObj[field] !== undefined && typeof pmObj[field] !== "string") {
      throw new Error(`Invalid Python environment: "pmInfo.${field}" must be a string`);
    }
  }
  if (pmObj.isStandalone !== undefined && typeof pmObj.isStandalone !== "boolean") {
    throw new Error('Invalid Python environment: "pmInfo.isStandalone" must be a boolean');
  }
}

function validatePmInfoStandalone(pmObj: Record<string, unknown>): void {
  if (pmObj.isStandalone === true) {
    const installCmds = pmObj.installCommands as unknown[];
    if (installCmds.length > 0) {
      throw new Error(
        'Invalid Python environment: standalone "pmInfo" must have empty installCommands array',
      );
    }
    if (pmObj.lockfile !== undefined || pmObj.configFile !== undefined) {
      throw new Error(
        'Invalid Python environment: standalone "pmInfo" cannot specify lockfile or configFile',
      );
    }
  }
}

function validateUvPmInfoInvariants(pmObj: Record<string, unknown>): void {
  if (pmObj.name === "uv") {
    if (pmObj.lockfile !== undefined && pmObj.lockfile !== "uv.lock") {
      throw new Error(
        'Invalid Python environment: UV lockfile name must be "uv.lock" when present',
      );
    }
    if (pmObj.lockfile === "uv.lock" && pmObj.configFile !== "pyproject.toml") {
      throw new Error(
        'Invalid Python environment: UV lockfile requires configFile "pyproject.toml"',
      );
    }
  }
}

function validatePythonPmInfo(pmInfo: unknown): void {
  if (!pmInfo || typeof pmInfo !== "object" || Array.isArray(pmInfo)) {
    throw new Error('Invalid Python environment: "pmInfo" must be an object when present');
  }
  const pmObj = pmInfo as Record<string, unknown>;
  validatePmInfoFields(pmObj);

  if (!("installCommands" in pmObj) || pmObj.installCommands === undefined) {
    throw new Error('Invalid Python environment: "pmInfo.installCommands" must be an array');
  }
  validateInstallCommands(pmObj.installCommands);
  validatePmInfoStandalone(pmObj);
  validateUvPmInfoInvariants(pmObj);
}

function validateNoPythonSourceEnv(pyObj: Record<string, unknown>): void {
  if (pyObj.packageManager !== null) {
    throw new Error(
      'Invalid Python environment: "packageManager" must be null when detected is false',
    );
  }
  if (pyObj.version !== "") {
    throw new Error(
      'Invalid Python environment: "version" must be empty string when detected is false',
    );
  }
  if (pyObj.ruffVersion !== "") {
    throw new Error(
      'Invalid Python environment: "ruffVersion" must be empty string when detected is false',
    );
  }
}

function validatePythonEnvironment(python: unknown): void {
  if (!python || typeof python !== "object") {
    throw new Error('Invalid environment: missing or invalid "python" section');
  }

  const pyObj = python as Record<string, unknown>;

  if (typeof pyObj.detected !== "boolean") {
    throw new Error('Invalid Python environment: "detected" must be a boolean');
  }
  if (typeof pyObj.version !== "string") {
    throw new Error('Invalid Python environment: "version" must be a string');
  }
  if (typeof pyObj.ruffVersion !== "string") {
    throw new Error('Invalid Python environment: "ruffVersion" must be a string');
  }
  if (!("packageManager" in pyObj) || pyObj.packageManager === undefined) {
    throw new Error('Invalid Python environment: "packageManager" property is required');
  }

  if (!pyObj.detected) {
    validateNoPythonSourceEnv(pyObj);
  } else {
    if (pyObj.packageManager === null) {
      throw new Error(
        'Invalid Python environment: "packageManager" cannot be null when detected is true',
      );
    }
    validatePythonPmInfo(pyObj.packageManager);
  }
}

/**
 * Validation
 * Basic sanity check on resolved aggregate environment before returning.
 */
export function validateEnvironment(env: ResolvedEnvironment): ResolvedEnvironment {
  if (!env || typeof env !== "object") {
    throw new Error("Invalid environment: must be a non-null object");
  }

  validateJsEnvironment(env.javascript);
  validatePythonEnvironment(env.python);

  return env;
}

/**
 * Writes the resolved environment values and tool setup parameters to GitHub Actions outputs.
 * Setup plan is derived directly from the supplied environment to guarantee environment/plan consistency.
 */
export function writeOutput(env: ResolvedEnvironment): void {
  const js = env.javascript;
  const python = env.python;
  const plan = createSetupPlan(env);

  // Internal setup outputs
  core.setOutput("node-version", plan.node.version);
  core.setOutput("bun-version", plan.bun.version);
  core.setOutput("pnpm-runtime", plan.pnpm.pnpmRuntime);
  core.setOutput("setup-node", String(plan.node.shouldSetup));
  core.setOutput("setup-node-cache", plan.node.cache);
  core.setOutput("setup-bun", String(plan.bun.shouldSetup));
  core.setOutput("setup-pnpm", String(plan.pnpm.shouldSetup));
  core.setOutput("setup-python", String(python.detected));

  // Public ecosystem outputs
  core.setOutput("javascript-detected", String(js.detected));
  core.setOutput("javascript-runtime", js.runtime.name);
  core.setOutput("javascript-runtime-version", js.runtime.version);
  core.setOutput("javascript-package-manager", js.packageManager.name);
  core.setOutput("javascript-package-manager-version", js.packageManager.version);
  core.setOutput("javascript-toolchain", js.toolchain ?? "");

  core.setOutput("python-detected", String(python.detected));
  core.setOutput("python-version", python.version);
  core.setOutput("python-setup-version", resolvePythonSetupVersion(python.version));
  core.setOutput("python-package-manager", python.packageManager ? python.packageManager.name : "");
  core.setOutput("ruff-version", python.ruffVersion);
  core.setOutput("ruff-setup-version", resolveRuffSetupVersion(python.ruffVersion));
}

function formatJsRuntime(js: ResolvedJavaScriptEnvironment): string {
  const runtimeName = js.runtime.name === "bun" ? "Bun" : "Node.js";
  return js.runtime.version ? `${runtimeName} ${js.runtime.version}` : runtimeName;
}

function formatPythonRuntime(py: ResolvedPythonEnvironment): string {
  return py.version && isExactVersion(py.version) ? `Python ${py.version}` : "Python";
}

function formatJsPackageManager(js: ResolvedJavaScriptEnvironment): string {
  return js.packageManager.version
    ? `${js.packageManager.name} ${js.packageManager.version}`
    : js.packageManager.name;
}

function formatPythonPackageManager(py: ResolvedPythonEnvironment): string | undefined {
  if (!py.packageManager) return undefined;
  const { name, version } = py.packageManager;
  if (version) {
    return `${name} ${version}`;
  }
  return name;
}

export function logResolvedEnvironment(env: ResolvedEnvironment): void {
  const js = env.javascript;
  const py = env.python;

  if (!js.detected && !py.detected) {
    core.info("No JavaScript or Python environment detected.");
    return;
  }

  const runtimes: string[] = [];
  if (js.detected) runtimes.push(formatJsRuntime(js));
  if (py.detected) runtimes.push(formatPythonRuntime(py));
  if (runtimes.length > 0) {
    core.info(`Runtime: ${runtimes.join(", ")}`);
  }

  const pms: string[] = [];
  if (js.detected) pms.push(formatJsPackageManager(js));
  if (py.detected) {
    const pyPm = formatPythonPackageManager(py);
    if (pyPm) pms.push(pyPm);
  }
  if (pms.length > 0) {
    core.info(`Package Manager: ${pms.join(", ")}`);
  }

  if (js.detected && js.toolchain === "vite-plus") {
    core.info("Toolchain: Vite+");
  }
}

/**
 * Executes the full environment resolution pipeline:
 * Input Parsing -> Language Resolution (JS & Python) -> Validation -> Aggregate Environment
 */
export function resolveEnvironment(
  toolchainInput: string = core.getInput("toolchain"),
): ResolvedEnvironment {
  const javascript = resolveJsEnvironment(toolchainInput);
  const python = resolvePythonEnvironment();

  const env: ResolvedEnvironment = {
    javascript,
    python,
  };

  const validated = validateEnvironment(env);
  logResolvedEnvironment(validated);

  return validated;
}

export function run(): void {
  try {
    const toolchainInput = core.getInput("toolchain");
    const env = resolveEnvironment(toolchainInput);
    writeOutput(env);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    core.setFailed(`Environment setup failed: ${msg}`);
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
