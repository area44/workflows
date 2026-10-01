import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  isSupportedPackageManager,
  isSupportedRuntime,
  validateRuntimePackageManagerCompatibility,
} from "./compatibility";
import { WorkflowError } from "./errors.js";
import { setupBun, setupNode, setupPackageManager } from "./setup-adapters";

export type { WorkflowErrorCode, WorkflowErrorContext } from "./errors.js";
export { isWorkflowError, WorkflowError } from "./errors.js";

export type { BunSetupConfig, NodeSetupConfig, PackageManagerSetupConfig } from "./setup-adapters";
export {
  getPnpmRuntime,
  resolvePnpmSetupRuntime,
  setupBun,
  setupNode,
  setupPackageManager,
} from "./setup-adapters";

export type {
  ActionInputContract,
  ActionOutputContract,
  BreakingChange,
  PublicActionContract,
  PublicActionName,
} from "./action-contract";
export {
  detectBreakingChanges,
  isPublicAction,
  parseActionContract,
  parseActionContractYaml,
  PUBLIC_ACTIONS,
  validateAllPublicActionContracts,
} from "./action-contract";

export type {
  CanonicalCompatibilityModel,
  CompatibilityStatus,
  MatrixCombinationEntry,
  MatrixEntry,
  RuntimePackageManagerCompatibility,
  SupportedAction,
  SupportedFixtureType,
  SupportedPackageManager,
  SupportedRuntime,
} from "./compatibility";
export {
  CANONICAL_COMPATIBILITY_MODEL,
  getCombinationCompatibility,
  getFixturePath,
  isSupportedAction,
  isSupportedFixtureType,
  isSupportedPackageManager,
  isSupportedRuntime,
  SUPPORTED_ACTIONS,
  SUPPORTED_FIXTURE_TYPES,
  SUPPORTED_PACKAGE_MANAGERS,
  SUPPORTED_RUNTIMES,
  validateFixtureForMatrixEntry,
  validateMatrixEntry,
  validateNoUnusedFixtures,
  validateRuntimePackageManagerCompatibility,
  validateWorkflowMatrix,
} from "./compatibility";

export {
  getExpectedArtifacts,
  parseViteConfigPack,
  runArtifactVerification,
  verifyArtifactIntegrity,
} from "./artifact-integrity";

/** Default Node.js fallback version */
// renovate: datasource=node-version depName=node versioning=node
export const DEFAULT_NODE_VERSION = "24";

/** Default Bun fallback version */
// renovate: datasource=npm depName=bun
export const DEFAULT_BUN_VERSION = "1.4";

/** Default npm fallback version */
// renovate: datasource=npm depName=npm
export const DEFAULT_NPM_VERSION = "12";

/** Default pnpm fallback version */
// renovate: datasource=npm depName=pnpm
export const DEFAULT_PNPM_VERSION = "12";

/**
 * Returns the default fallback version for a given package manager name.
 */
export function getDefaultPackageManagerVersion(pmName: string): string {
  switch (pmName.toLowerCase()) {
    case "pnpm":
      return DEFAULT_PNPM_VERSION;
    case "bun":
      return DEFAULT_BUN_VERSION;
    case "npm":
    default:
      return DEFAULT_NPM_VERSION;
  }
}

export interface PackageManager {
  name: string;
  version: string;
}

export interface ResolvedEnvironment {
  nodeVersion: string;
  bunVersion: string;
  pm: PackageManager;
  runtime: "node" | "bun";
}

/** Legacy type alias for ResolvedEnvironment */
export type DetectedEnv = ResolvedEnvironment;

export interface ParsedInputs {
  specifiedRuntime?: "node" | "bun";
  nodeVersion?: string;
  bunVersion?: string;
}

export interface ProjectEnvironment {
  nvmRcVersion?: string;
  nvmRcError?: string;
  nodeFileVersion?: string;
  nodeFileError?: string;
  bunFileVersion?: string;
  bunFileError?: string;
  packageJson?: any;
  packageJsonError?: string;
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
}

function getDevEngineRuntimeVersion(pkg: any, runtimeName: "node" | "bun"): string | undefined {
  const defaultVersion = runtimeName === "bun" ? DEFAULT_BUN_VERSION : DEFAULT_NODE_VERSION;
  if (pkg.devEngines) {
    if (pkg.devEngines.runtime) {
      const runtimes = Array.isArray(pkg.devEngines.runtime)
        ? pkg.devEngines.runtime
        : [pkg.devEngines.runtime];
      for (const r of runtimes) {
        if (typeof r === "string" && r.toLowerCase().startsWith(runtimeName)) {
          const atIdx = r.indexOf("@");
          return atIdx !== -1 ? r.slice(atIdx + 1) : defaultVersion;
        } else if (typeof r === "object" && r !== null && r.name === runtimeName) {
          return r.version || defaultVersion;
        }
      }
    }
    if (pkg.devEngines[runtimeName]) {
      const val = pkg.devEngines[runtimeName];
      return typeof val === "string" ? val : val.version || defaultVersion;
    }
  }
  return undefined;
}

function getDevEnginePackageManager(pkg: any): PackageManager | undefined {
  if (!pkg.devEngines) return undefined;

  if (pkg.devEngines.packageManager) {
    const pm = Array.isArray(pkg.devEngines.packageManager)
      ? pkg.devEngines.packageManager[0]
      : pkg.devEngines.packageManager;

    if (typeof pm === "string") {
      const [name, version] = pm.split("@");
      return { name, version: version || getDefaultPackageManagerVersion(name) };
    } else if (typeof pm === "object" && pm !== null && pm.name) {
      return { name: pm.name, version: pm.version || getDefaultPackageManagerVersion(pm.name) };
    }
  }

  for (const pm of ["pnpm", "npm", "bun"]) {
    if (!isSupportedPackageManager(pm)) continue;
    if (pkg.devEngines[pm]) {
      const val = pkg.devEngines[pm];
      const defaultVer = getDefaultPackageManagerVersion(pm);
      const version = typeof val === "string" ? val : val.version || defaultVer;
      return { name: pm, version };
    }
  }

  return undefined;
}

function validateCommaStructure(trimmed: string, runtimeInput: string): void {
  if (trimmed.startsWith(",") || trimmed.endsWith(",") || /,[\s]*,/.test(trimmed)) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid runtime input "${runtimeInput}": malformed comma placement. Supported runtime specifiers are "node", "bun", "node@<version>", "bun@<version>", or "both".`,
      { input: runtimeInput, reason: "malformed_comma_placement" },
    );
  }
}

interface ParsedPart {
  type: "node" | "bun" | "both";
  version?: string;
}

function parseSingleRuntimePart(rawPart: string, runtimeInput: string): ParsedPart {
  const part = rawPart.toLowerCase();

  if (part === "both") {
    return { type: "both" };
  }
  if (part === "node") {
    return { type: "node" };
  }
  if (part === "bun") {
    return { type: "bun" };
  }

  const isNodeSpec = part.startsWith("node@");
  const isBunSpec = part.startsWith("bun@");

  if (isNodeSpec || isBunSpec) {
    const prefixLen = isNodeSpec ? 5 : 4;
    const ver = part.slice(prefixLen);
    if (!ver || ver.includes("@") || ver.includes(",") || /\s/.test(ver)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid runtime input "${runtimeInput}": malformed version specifier in "${rawPart}". Supported runtime specifiers are "node", "bun", "node@<version>", "bun@<version>", or "both".`,
        { input: runtimeInput, rawPart, reason: "malformed_version_specifier" },
      );
    }
    return { type: isNodeSpec ? "node" : "bun", version: ver };
  }

  throw new WorkflowError(
    "INVALID_INPUT",
    `Invalid runtime input "${runtimeInput}": unrecognized or malformed runtime specifier "${rawPart}". Supported runtime specifiers are "node", "bun", "node@<version>", "bun@<version>", or "both".`,
    { input: runtimeInput, rawPart, reason: "unrecognized_runtime_specifier" },
  );
}

/**
 * Input Parsing
 * Parses raw action runtime inputs into normalized input representations.
 */
export function parseEnvironmentInputs(
  runtimeInput: string = core.getInput("runtime"),
): ParsedInputs {
  if (!runtimeInput) return {};

  const trimmed = runtimeInput.trim();
  if (!trimmed) return {};

  validateCommaStructure(trimmed, runtimeInput);

  const parts = trimmed.split(/[\s,]+/);
  let specifiedRuntime: "node" | "bun" | undefined;
  let nodeVersion: string | undefined;
  let bunVersion: string | undefined;

  let hasBun = false;
  const counts = { node: 0, bun: 0, both: 0 };

  for (const rawPart of parts) {
    const parsed = parseSingleRuntimePart(rawPart, runtimeInput);
    counts[parsed.type]++;

    if (parsed.type === "both") {
      hasBun = true;
    } else if (parsed.type === "node") {
      if (!specifiedRuntime) specifiedRuntime = "node";
      if (parsed.version) nodeVersion = parsed.version;
    } else if (parsed.type === "bun") {
      hasBun = true;
      if (!specifiedRuntime) specifiedRuntime = "bun";
      if (parsed.version) bunVersion = parsed.version;
    }
  }

  if (counts.node > 1) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid runtime input "${runtimeInput}": duplicate or conflicting specifiers for "node".`,
      { input: runtimeInput, specifier: "node", reason: "duplicate_specifier" },
    );
  }
  if (counts.bun > 1) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid runtime input "${runtimeInput}": duplicate or conflicting specifiers for "bun".`,
      { input: runtimeInput, specifier: "bun", reason: "duplicate_specifier" },
    );
  }
  if (counts.both > 1) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid runtime input "${runtimeInput}": duplicate or conflicting specifiers for "both".`,
      { input: runtimeInput, specifier: "both", reason: "duplicate_specifier" },
    );
  }

  return {
    specifiedRuntime,
    nodeVersion,
    bunVersion: bunVersion || (hasBun ? DEFAULT_BUN_VERSION : undefined),
  };
}

/** Legacy wrapper alias for parseEnvironmentInputs */
export const parseRuntimeInput = parseEnvironmentInputs;

/**
 * Project Environment Inspection
 * Inspects raw project state from workspace files and configurations.
 */
export function inspectProjectEnvironment(): ProjectEnvironment {
  let nvmRcVersion: string | undefined;
  let nvmRcError: string | undefined;
  let nodeFileVersion: string | undefined;
  let nodeFileError: string | undefined;
  let bunFileVersion: string | undefined;
  let bunFileError: string | undefined;
  let packageJson: any;
  let packageJsonError: string | undefined;
  let hasPnpmLock = false;
  let hasPackageLock = false;
  let hasBunLock = false;

  try {
    if (fs.existsSync(".nvmrc")) {
      nvmRcVersion = fs.readFileSync(".nvmrc", "utf8").trim();
    }
  } catch (err) {
    nvmRcError = err instanceof Error ? err.message : String(err);
  }

  try {
    if (fs.existsSync(".node-version")) {
      nodeFileVersion = fs.readFileSync(".node-version", "utf8").trim();
    }
  } catch (err) {
    nodeFileError = err instanceof Error ? err.message : String(err);
  }

  try {
    if (fs.existsSync(".bun-version")) {
      bunFileVersion = fs.readFileSync(".bun-version", "utf8").trim();
    }
  } catch (err) {
    bunFileError = err instanceof Error ? err.message : String(err);
  }

  try {
    if (fs.existsSync("package.json")) {
      packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    }
  } catch (err) {
    packageJsonError = err instanceof Error ? err.message : String(err);
  }

  try {
    hasPnpmLock = fs.existsSync("pnpm-lock.yaml");
    hasPackageLock = fs.existsSync("package-lock.json");
    hasBunLock = fs.existsSync("bun.lock") || fs.existsSync("bun.lockb");
  } catch {
    // Ignore detection errors
  }

  return {
    nvmRcVersion,
    nvmRcError,
    nodeFileVersion,
    nodeFileError,
    bunFileVersion,
    bunFileError,
    packageJson,
    packageJsonError,
    hasPnpmLock,
    hasPackageLock,
    hasBunLock,
  };
}

/** Legacy wrapper alias for inspectProjectEnvironment */
export const detectProjectEnvironment = inspectProjectEnvironment;

/**
 * Package Manager Resolution
 * Resolves final package manager and version given project environment state.
 */
export function resolvePackageManager(project: ProjectEnvironment): PackageManager {
  if (project.packageJsonError) {
    core.warning(`Failed to detect package manager: ${project.packageJsonError}`);
  } else if (project.packageJson) {
    const pkg = project.packageJson;
    if (pkg.packageManager && typeof pkg.packageManager === "string") {
      const [name, version] = pkg.packageManager.split("@");
      const pmVersion = version || getDefaultPackageManagerVersion(name);
      core.info(`Found packageManager in package.json: ${name}@${pmVersion}`);
      return { name, version: pmVersion };
    }

    const devPm = getDevEnginePackageManager(pkg);
    if (devPm) {
      core.info(`Found packageManager in package.json devEngines: ${devPm.name}@${devPm.version}`);
      return devPm;
    }
  }

  if (project.hasPnpmLock) {
    core.info(`Found pnpm-lock.yaml, using pnpm@${DEFAULT_PNPM_VERSION}`);
    return { name: "pnpm", version: DEFAULT_PNPM_VERSION };
  }
  if (project.hasPackageLock) {
    core.info(`Found package-lock.json, using npm@${DEFAULT_NPM_VERSION}`);
    return { name: "npm", version: DEFAULT_NPM_VERSION };
  }
  if (project.hasBunLock) {
    core.info(`Found bun lockfile, using bun@${DEFAULT_BUN_VERSION}`);
    return { name: "bun", version: DEFAULT_BUN_VERSION };
  }

  core.info(`Package manager not specified, using npm@${DEFAULT_NPM_VERSION}`);
  return { name: "npm", version: DEFAULT_NPM_VERSION };
}

/**
 * Runtime Resolution
 * Resolves target runtime according to canonical precedence:
 * explicit specifiedRuntime > package manager derived runtime > default node runtime
 */
export function resolveRuntime(parsed: ParsedInputs, pm: PackageManager): "node" | "bun" {
  if (parsed.specifiedRuntime) {
    return parsed.specifiedRuntime;
  }
  if (pm.name === "bun") {
    return "bun";
  }
  return "node";
}

/** Legacy helper wrapper for runtime resolution */
export function detectRuntime(pm: PackageManager, bunVersion?: string): "node" | "bun" {
  if (pm.name === "bun" || Boolean(bunVersion)) {
    return "bun";
  }
  return "node";
}

/**
 * Version Resolution
 * Resolves Node.js version based on parsed inputs, runtime, and project state.
 */
export function resolveNodeVersion(
  parsed: ParsedInputs,
  pm: PackageManager,
  runtime: "node" | "bun",
  project: ProjectEnvironment,
): string {
  if (parsed.nodeVersion !== undefined) {
    return parsed.nodeVersion;
  }

  if (parsed.specifiedRuntime === "bun") {
    return "";
  }

  if (project.nvmRcError) {
    core.warning(`Failed to detect Node.js version: ${project.nvmRcError}`);
  } else if (project.nvmRcVersion) {
    core.info(`Found .nvmrc: ${project.nvmRcVersion}`);
    return project.nvmRcVersion;
  }

  if (project.nodeFileError) {
    core.warning(`Failed to detect Node.js version: ${project.nodeFileError}`);
  } else if (project.nodeFileVersion) {
    core.info(`Found .node-version: ${project.nodeFileVersion}`);
    return project.nodeFileVersion;
  }

  if (project.packageJsonError) {
    core.warning(`Failed to detect Node.js version: ${project.packageJsonError}`);
  } else if (project.packageJson) {
    const devVersion = getDevEngineRuntimeVersion(project.packageJson, "node");
    if (devVersion) {
      core.info(`Found Node.js version in package.json devEngines: ${devVersion}`);
      return devVersion;
    }
  }

  if (runtime === "bun" || pm.name === "bun") {
    return "";
  }

  core.info(`Node.js version not specified, using ${DEFAULT_NODE_VERSION}`);
  return DEFAULT_NODE_VERSION;
}

/**
 * Version Resolution
 * Resolves Bun version based on parsed inputs, package manager, and project state.
 */
export function resolveBunVersion(
  parsed: ParsedInputs,
  pm: PackageManager,
  project: ProjectEnvironment,
): string {
  if (parsed.bunVersion !== undefined) {
    return parsed.bunVersion;
  }

  if (project.bunFileError) {
    core.warning(`Failed to detect Bun version: ${project.bunFileError}`);
  } else if (project.bunFileVersion) {
    core.info(`Found .bun-version: ${project.bunFileVersion}`);
    return project.bunFileVersion;
  }

  if (pm.name === "bun" && pm.version && pm.version !== "latest") {
    return pm.version;
  }

  if (project.packageJsonError) {
    core.warning(`Failed to detect Bun version: ${project.packageJsonError}`);
  } else if (project.packageJson) {
    const devVersion = getDevEngineRuntimeVersion(project.packageJson, "bun");
    if (devVersion) {
      core.info(`Found Bun version in package.json devEngines: ${devVersion}`);
      return devVersion;
    }
  }

  const hasBunEngine =
    project.packageJson && getDevEngineRuntimeVersion(project.packageJson, "bun") !== undefined;
  const isBunDetected = pm.name === "bun" || project.hasBunLock || hasBunEngine;

  if (isBunDetected) {
    return DEFAULT_BUN_VERSION;
  }

  return "";
}

/**
 * Version Resolution
 * Resolves nodeVersion and bunVersion.
 */
export function resolveVersions(
  parsed: ParsedInputs,
  pm: PackageManager,
  runtime: "node" | "bun",
  project: ProjectEnvironment,
): { nodeVersion: string; bunVersion: string } {
  return {
    nodeVersion: resolveNodeVersion(parsed, pm, runtime, project),
    bunVersion: resolveBunVersion(parsed, pm, project),
  };
}

/**
 * Legacy wrapper function for detecting package manager.
 */
export function detectPackageManager(): PackageManager {
  const project = inspectProjectEnvironment();
  return resolvePackageManager(project);
}

/**
 * Legacy wrapper function for detecting Node.js version.
 */
export function detectNodeVersion(pmName?: string): string {
  const project = inspectProjectEnvironment();
  const dummyPm = { name: pmName || "npm", version: "" };
  const runtime = pmName === "bun" ? "bun" : "node";
  return resolveNodeVersion({}, dummyPm, runtime, project);
}

/**
 * Legacy wrapper function for detecting Bun version.
 */
export function detectBunVersion(pm: PackageManager): string {
  const project = inspectProjectEnvironment();
  return resolveBunVersion({}, pm, project);
}

/**
 * Validation
 * Basic sanity check on resolved environment before returning.
 */
export function validateEnvironment(env: ResolvedEnvironment): ResolvedEnvironment {
  const rt = env.runtime as string;
  if (!isSupportedRuntime(rt)) {
    throw new WorkflowError("SETUP_FAILURE", `Invalid resolved runtime: "${rt}"`, {
      stage: "environment-validation",
      runtime: rt,
    });
  }
  if (!env.pm || !env.pm.name || !env.pm.version) {
    throw new WorkflowError(
      "SETUP_FAILURE",
      `Invalid resolved package manager: ${JSON.stringify(env.pm)}`,
      { stage: "environment-validation", pm: env.pm },
    );
  }
  if (typeof env.nodeVersion !== "string" || typeof env.bunVersion !== "string") {
    throw new WorkflowError(
      "SETUP_FAILURE",
      `Invalid resolved versions: node="${env.nodeVersion}", bun="${env.bunVersion}"`,
      { stage: "environment-validation", nodeVersion: env.nodeVersion, bunVersion: env.bunVersion },
    );
  }
  validateRuntimePackageManagerCompatibility(env.runtime, env.pm.name);
  return env;
}

/**
 * Writes the resolved environment values and tool setup parameters to GitHub Actions outputs.
 */
export function writeOutput(env: ResolvedEnvironment): void;
export function writeOutput(
  nodeVersion: string,
  pm: PackageManager,
  bunVersion?: string,
  runtime?: "bun" | "node",
): void;
export function writeOutput(
  nodeVersionOrEnv: string | ResolvedEnvironment,
  pm?: PackageManager,
  bunVersion: string = "",
  runtime: "bun" | "node" = "node",
): void {
  let env: ResolvedEnvironment;
  if (typeof nodeVersionOrEnv === "object" && nodeVersionOrEnv !== null) {
    env = nodeVersionOrEnv;
  } else {
    if (!pm) {
      throw new WorkflowError("SETUP_FAILURE", "Missing package manager parameter in writeOutput", {
        stage: "write-output",
      });
    }
    env = {
      nodeVersion: nodeVersionOrEnv,
      pm,
      bunVersion,
      runtime,
    };
  }

  const nodeSetup = setupNode(env);
  const bunSetup = setupBun(env);
  const pmSetup = setupPackageManager(env);

  core.setOutput("node-version", env.nodeVersion);
  core.setOutput("bun-version", env.bunVersion);
  core.setOutput("package-manager", env.pm.name);
  core.setOutput("package-manager-version", env.pm.version);
  core.setOutput("runtime", env.runtime);
  core.setOutput("pnpm-runtime", pmSetup.pnpmRuntime);

  core.setOutput("setup-node", String(nodeSetup.shouldSetup));
  core.setOutput("setup-node-cache", nodeSetup.cache);
  core.setOutput("setup-bun", String(bunSetup.shouldSetup));
  core.setOutput("setup-pnpm", String(pmSetup.shouldSetupPnpm));
}

/**
 * Executes the full environment resolution pipeline:
 * Input Parsing -> Project Inspection -> PM Resolution -> Runtime Resolution -> Version Resolution -> Validation -> Environment
 */
export function resolveEnvironment(
  runtimeInput: string = core.getInput("runtime"),
): ResolvedEnvironment {
  const parsedInputs = parseEnvironmentInputs(runtimeInput);
  const project = inspectProjectEnvironment();
  const pm = resolvePackageManager(project);
  const runtime = resolveRuntime(parsedInputs, pm);
  const versions = resolveVersions(parsedInputs, pm, runtime, project);

  const env: ResolvedEnvironment = {
    nodeVersion: versions.nodeVersion,
    bunVersion: versions.bunVersion,
    pm,
    runtime,
  };

  return validateEnvironment(env);
}

/** Legacy wrapper alias for resolveEnvironment */
export const detectEnv = resolveEnvironment;

export function run(): void {
  try {
    const runtimeInput = core.getInput("runtime");
    const env = resolveEnvironment(runtimeInput);
    writeOutput(env.nodeVersion, env.pm, env.bunVersion, env.runtime);
  } catch (error) {
    if (error instanceof WorkflowError) {
      core.setFailed(error);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      const setupErr = new WorkflowError("SETUP_FAILURE", `Environment setup failed: ${msg}`, {
        stage: "environment-resolution",
        cause: error,
      });
      core.setFailed(setupErr);
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
