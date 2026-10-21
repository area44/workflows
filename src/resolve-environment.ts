import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isSupportedRuntime,
  resolveJsEnvironment,
  validateRuntimePackageManagerCompatibility,
  type ResolvedJsEnvironment,
} from "./javascript-env.js";
import { resolvePythonEnvironment, type ResolvedPythonEnvironment } from "./python-env.js";
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
  ResolvedJsEnvironment,
  ResolvedPythonEnvironment,
  BunSetupConfig,
  NodeSetupConfig,
  PackageManagerSetupConfig,
};

export {
  resolveJsEnvironment,
  resolvePythonEnvironment,
  resolvePnpmSetupRuntime,
  setupBun,
  setupNode,
  setupPackageManager,
};

export interface ResolvedEnvironment {
  js: ResolvedJsEnvironment;
  python: ResolvedPythonEnvironment;
}

/**
 * Validation
 * Basic sanity check on resolved aggregate environment before returning.
 */
export function validateEnvironment(env: ResolvedEnvironment): ResolvedEnvironment {
  const js = env?.js;
  if (!js || !isSupportedRuntime(js.runtime)) {
    throw new Error(`Invalid resolved runtime: "${js?.runtime}"`);
  }
  if (!js.pm || !js.pm.name || !js.pm.version) {
    throw new Error(`Invalid resolved package manager: ${JSON.stringify(js?.pm)}`);
  }
  if (typeof js.nodeVersion !== "string" || typeof js.bunVersion !== "string") {
    throw new Error(`Invalid resolved versions: node="${js.nodeVersion}", bun="${js.bunVersion}"`);
  }
  validateRuntimePackageManagerCompatibility(js.runtime, js.pm.name);
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

  core.setOutput("node-version", js.nodeVersion);
  core.setOutput("bun-version", js.bunVersion);
  core.setOutput("package-manager", js.pm.name);
  core.setOutput("package-manager-version", js.pm.version);
  core.setOutput("runtime", js.runtime);
  core.setOutput("toolchain", js.toolchain);
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
 * Input Parsing -> Language Resolution (JS & Python) -> Validation -> Aggregate Environment
 */
export function resolveEnvironment(
  runtimeInput: string = core.getInput("runtime"),
  toolchainInput: string = core.getInput("toolchain"),
): ResolvedEnvironment {
  const js = resolveJsEnvironment(runtimeInput, toolchainInput);
  const python = resolvePythonEnvironment();

  const env: ResolvedEnvironment = {
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
