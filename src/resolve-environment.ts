import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  hasVitePlusDependency,
  inspectJsProjectEnvironment,
  isSupportedPackageManager,
  isSupportedRuntime,
  parseEnvironmentInputs,
  resolveBunVersion,
  resolveJsPackageManager,
  resolveNodeVersion,
  resolveRuntime,
  resolveToolchain,
  resolveVersions,
  validateRuntimePackageManagerCompatibility,
  type JsProjectEnvironment,
  type PackageManager,
  type ParsedInputs,
  type SupportedPackageManager,
  type SupportedRuntime,
  type Toolchain,
  type ToolchainInput,
} from "./javascript-env.js";
import {
  detectPythonPackageManager,
  hasPythonSource,
  resolvePythonVersion,
  resolveRuffVersion,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  type PythonPackageManager,
  type PythonPackageManagerInfo,
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
}

/**
 * Project Environment Inspection
 * Inspects raw project state from workspace files and configurations.
 */
export function inspectProjectEnvironment(cwd: string = process.cwd()): ProjectEnvironment {
  return inspectJsProjectEnvironment(cwd);
}

/**
 * Package Manager Resolution
 * Resolves final package manager and version given project environment state.
 */
export function resolvePackageManager(project: ProjectEnvironment): PackageManager {
  return resolveJsPackageManager(project);
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
  const project = inspectProjectEnvironment();
  const hasJsProject = project.hasPackageJson;

  const nodeSetup = setupNode(env);
  const bunSetup = setupBun(env);
  const pmSetup = setupPackageManager(env);

  const hasPySource = hasPythonSource();
  core.setOutput("has-python-source", String(hasPySource));
  core.setOutput("setup-python", String(hasPySource));

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

  if (hasPySource) {
    const pyVersion = resolvePythonVersion();
    const pythonPmInfo = detectPythonPackageManager();
    const ruffVer = resolveRuffVersion();

    core.setOutput("python-version", pyVersion);
    core.setOutput("ruff-version", ruffVer);
    core.setOutput("python-package-manager", pythonPmInfo ? pythonPmInfo.name : "");
  } else {
    core.setOutput("python-version", "");
    core.setOutput("ruff-version", "");
    core.setOutput("python-package-manager", "");
  }
}

/**
 * Executes the full environment resolution pipeline:
 * Input Parsing -> Project Inspection -> PM Resolution -> Runtime Resolution -> Version Resolution -> Validation -> Environment
 */
export function resolveEnvironment(
  runtimeInput: string = core.getInput("runtime"),
  toolchainInput: string = core.getInput("toolchain"),
): ResolvedEnvironment {
  const parsedInputs = parseEnvironmentInputs(runtimeInput);
  const project = inspectJsProjectEnvironment();
  const pm = resolveJsPackageManager(project);
  const runtime = resolveRuntime(parsedInputs, pm);
  const versions = resolveVersions(parsedInputs, pm, runtime, project);
  const toolchain = resolveToolchain(toolchainInput, project);

  const env: ResolvedEnvironment = {
    nodeVersion: versions.nodeVersion,
    bunVersion: versions.bunVersion,
    pm,
    runtime,
    toolchain,
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
