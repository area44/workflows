import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  hasVitePlusDependency,
  isSupportedPackageManager,
  isSupportedRuntime,
  parseEnvironmentInputs,
  resolveBunVersion,
  resolveJsEnvironment,
  resolveNodeVersion,
  resolveRuntime,
  resolveToolchain,
  resolveVersions,
  validateRuntimePackageManagerCompatibility,
  type JsProjectEnvironment,
  type PackageManager,
  type ParsedInputs,
  type ResolvedJsEnvironment,
  type SupportedPackageManager,
  type SupportedRuntime,
  type Toolchain,
  type ToolchainInput,
} from "./javascript-env.js";
import {
  detectPythonPackageManager,
  resolvePythonEnvironment,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  type PythonPackageManager,
  type PythonPackageManagerInfo,
  type ResolvedPythonEnvironment,
} from "./python-env.js";
import {
  resolvePnpmSetupRuntime,
  setupBun,
  setupNode,
  setupPackageManager,
  type BunSetupConfig,
  type NodeSetupConfig,
  type PackageManagerSetupConfig,
} from "./setup-adapters.js";

export type {
  SupportedRuntime,
  SupportedPackageManager,
  Toolchain,
  ToolchainInput,
  PackageManager,
  ParsedInputs,
  ResolvedJsEnvironment,
  ResolvedPythonEnvironment,
  BunSetupConfig,
  NodeSetupConfig,
  PackageManagerSetupConfig,
  PythonPackageManager,
  PythonPackageManagerInfo,
};

export type ProjectEnvironment = JsProjectEnvironment;

export {
  isSupportedRuntime,
  isSupportedPackageManager,
  validateRuntimePackageManagerCompatibility,
  parseEnvironmentInputs,
  resolveRuntime,
  resolveNodeVersion,
  resolveBunVersion,
  resolveVersions,
  hasVitePlusDependency,
  resolveToolchain,
  resolveJsEnvironment,
  resolvePythonEnvironment,
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  detectPythonPackageManager,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  resolvePnpmSetupRuntime,
  setupBun,
  setupNode,
  setupPackageManager,
};

export interface ResolvedEnvironment {
  nodeVersion: string;
  bunVersion: string;
  pm: PackageManager;
  runtime: "node" | "bun";
  toolchain: Toolchain;
  js: ResolvedJsEnvironment;
  python: ResolvedPythonEnvironment;
}

/**
 * Validation
 * Basic sanity check on resolved environment before returning.
 */
export function validateEnvironment(env: ResolvedEnvironment): ResolvedEnvironment {
  const rt = env.runtime as string;
  if (!isSupportedRuntime(rt)) {
    throw new Error(`Invalid resolved runtime: "${rt}"`);
  }
  if (!env.pm || !env.pm.name || !env.pm.version) {
    throw new Error(`Invalid resolved package manager: ${JSON.stringify(env.pm)}`);
  }
  if (typeof env.nodeVersion !== "string" || typeof env.bunVersion !== "string") {
    throw new Error(
      `Invalid resolved versions: node="${env.nodeVersion}", bun="${env.bunVersion}"`,
    );
  }
  validateRuntimePackageManagerCompatibility(env.runtime, env.pm.name);
  return env;
}

/**
 * Writes the resolved environment values and tool setup parameters to GitHub Actions outputs.
 */
export function writeOutput(env: ResolvedEnvironment): void {
  const js = env.js;
  const python = env.python;
  const hasJsProject = js.hasJsProject;

  const nodeSetup = setupNode(env);
  const bunSetup = setupBun(env);
  const pmSetup = setupPackageManager(env);

  core.setOutput("has-python-source", String(python.hasPythonSource));
  core.setOutput("setup-python", String(python.hasPythonSource));

  core.setOutput("node-version", env.nodeVersion);
  core.setOutput("bun-version", env.bunVersion);
  core.setOutput("package-manager", env.pm.name);
  core.setOutput("package-manager-version", env.pm.version);
  core.setOutput("runtime", env.runtime);
  core.setOutput("toolchain", env.toolchain);
  core.setOutput("pnpm-runtime", pmSetup.pnpmRuntime);

  core.setOutput("has-js-project", String(hasJsProject));
  core.setOutput("setup-node", String(hasJsProject && nodeSetup.shouldSetup));
  core.setOutput("setup-node-cache", hasJsProject ? nodeSetup.cache : "");
  core.setOutput("setup-bun", String(hasJsProject && bunSetup.shouldSetup));
  core.setOutput("setup-pnpm", String(hasJsProject && pmSetup.shouldSetupPnpm));

  if (python.hasPythonSource) {
    core.setOutput("python-version", python.pythonVersion);
    core.setOutput("ruff-version", python.ruffVersion);
    core.setOutput("python-package-manager", python.pmInfo ? python.pmInfo.name : "");
  } else {
    core.setOutput("python-version", "");
    core.setOutput("ruff-version", "");
    core.setOutput("python-package-manager", "");
  }
}

/**
 * Executes the full environment resolution pipeline:
 * Input Parsing -> Language Resolution (JS & Python) -> Validation -> Environment
 */
export function resolveEnvironment(
  runtimeInput: string = core.getInput("runtime"),
  toolchainInput: string = core.getInput("toolchain"),
): ResolvedEnvironment {
  const js = resolveJsEnvironment(runtimeInput, toolchainInput);
  const python = resolvePythonEnvironment();

  const env: ResolvedEnvironment = {
    nodeVersion: js.nodeVersion,
    bunVersion: js.bunVersion,
    pm: js.pm,
    runtime: js.runtime,
    toolchain: js.toolchain,
    js,
    python,
  };

  return validateEnvironment(env);
}

export function run(): void {
  try {
    const runtimeInput = core.getInput("runtime");
    const toolchainInput = core.getInput("toolchain");
    const env = resolveEnvironment(runtimeInput, toolchainInput);
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
