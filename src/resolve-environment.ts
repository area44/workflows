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

function validateJsEnvironment(js: unknown): void {
  if (!js || typeof js !== "object") {
    throw new Error('Invalid environment: missing or invalid "js" section');
  }

  const jsObj = js as Record<string, unknown>;

  if (typeof jsObj.hasJsProject !== "boolean") {
    throw new Error('Invalid JavaScript environment: "hasJsProject" must be a boolean');
  }

  const runtime = jsObj.runtime;
  if (typeof runtime !== "string" || !isSupportedRuntime(runtime)) {
    throw new Error(`Invalid resolved runtime: "${String(runtime)}"`);
  }

  const pm = jsObj.pm as Record<string, unknown> | undefined;
  if (
    !pm ||
    typeof pm !== "object" ||
    typeof pm.name !== "string" ||
    typeof pm.version !== "string" ||
    !pm.name ||
    !pm.version
  ) {
    throw new Error("Invalid resolved package manager");
  }

  if (typeof jsObj.nodeVersion !== "string" || typeof jsObj.bunVersion !== "string") {
    throw new Error(
      `Invalid resolved versions: node="${String(jsObj.nodeVersion)}", bun="${String(jsObj.bunVersion)}"`,
    );
  }

  if (
    typeof jsObj.toolchain !== "string" ||
    (jsObj.toolchain !== "vite" && jsObj.toolchain !== "vite-plus")
  ) {
    throw new Error(`Invalid resolved toolchain: "${String(jsObj.toolchain)}"`);
  }

  validateRuntimePackageManagerCompatibility(runtime, pm.name);
}

function validatePythonPmInfo(pmInfo: unknown): void {
  if (!pmInfo || typeof pmInfo !== "object") {
    throw new Error('Invalid Python environment: "pmInfo" must be an object when present');
  }

  const pmObj = pmInfo as Record<string, unknown>;

  if (pmObj.name !== "uv" && pmObj.name !== "pip") {
    throw new Error(`Invalid Python environment: pmInfo name must be "uv" or "pip"`);
  }

  if (typeof pmObj.installCommand !== "string") {
    throw new Error('Invalid Python environment: "pmInfo.installCommand" must be a string');
  }

  if (typeof pmObj.execPrefix !== "string") {
    throw new Error('Invalid Python environment: "pmInfo.execPrefix" must be a string');
  }

  const optionalStrings = ["lockfile", "configFile", "lockCommand", "syncCommand"];
  for (const field of optionalStrings) {
    if (pmObj[field] !== undefined && typeof pmObj[field] !== "string") {
      throw new Error(`Invalid Python environment: "pmInfo.${field}" must be a string`);
    }
  }

  if (pmObj.isStandalone !== undefined && typeof pmObj.isStandalone !== "boolean") {
    throw new Error('Invalid Python environment: "pmInfo.isStandalone" must be a boolean');
  }

  if (pmObj.installCommands !== undefined) {
    if (!Array.isArray(pmObj.installCommands)) {
      throw new Error('Invalid Python environment: "pmInfo.installCommands" must be an array');
    }
    for (const cmd of pmObj.installCommands) {
      if (
        !cmd ||
        typeof cmd !== "object" ||
        typeof cmd.executable !== "string" ||
        !Array.isArray(cmd.args) ||
        !cmd.args.every((a: unknown) => typeof a === "string")
      ) {
        throw new Error('Invalid Python environment: malformed "installCommands" item');
      }
    }
  }
}

function validatePythonEnvironment(python: unknown): void {
  if (!python || typeof python !== "object") {
    throw new Error('Invalid environment: missing or invalid "python" section');
  }

  const pyObj = python as Record<string, unknown>;

  if (typeof pyObj.hasPythonSource !== "boolean") {
    throw new Error('Invalid Python environment: "hasPythonSource" must be a boolean');
  }

  if (typeof pyObj.pythonVersion !== "string") {
    throw new Error('Invalid Python environment: "pythonVersion" must be a string');
  }

  if (typeof pyObj.ruffVersion !== "string") {
    throw new Error('Invalid Python environment: "ruffVersion" must be a string');
  }

  if (pyObj.pmInfo !== null && pyObj.pmInfo !== undefined) {
    validatePythonPmInfo(pyObj.pmInfo);
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

  validateJsEnvironment(env.js);
  validatePythonEnvironment(env.python);

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
