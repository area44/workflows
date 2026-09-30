import * as core from "@actions/core";
import fs from "node:fs";

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

export interface DetectedEnv {
  nodeVersion: string;
  bunVersion: string;
  pm: PackageManager;
  runtime: "node" | "bun";
}

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
    if (pkg.devEngines[pm]) {
      const val = pkg.devEngines[pm];
      const defaultVer = getDefaultPackageManagerVersion(pm);
      const version = typeof val === "string" ? val : val.version || defaultVer;
      return { name: pm, version };
    }
  }

  return undefined;
}

/**
 * Step 1: Input Parsing
 * Parses raw action runtime inputs into normalized input representations.
 */
export function parseEnvironmentInputs(
  runtimeInput: string = core.getInput("runtime"),
): ParsedInputs {
  if (!runtimeInput) return {};

  const trimmed = runtimeInput.trim().toLowerCase();
  const parts = trimmed.split(/[\s,]+/);
  let specifiedRuntime: "node" | "bun" | undefined;
  let nodeVersion: string | undefined;
  let bunVersion: string | undefined;

  let hasBun = false;

  for (const part of parts) {
    if (part === "both") {
      hasBun = true;
    } else if (part.startsWith("node")) {
      if (!specifiedRuntime) specifiedRuntime = "node";
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        nodeVersion = part.slice(atIdx + 1);
      }
    } else if (part.startsWith("bun")) {
      hasBun = true;
      if (!specifiedRuntime) specifiedRuntime = "bun";
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        bunVersion = part.slice(atIdx + 1);
      }
    }
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
 * Step 2: Project Environment Detection
 * Discovers raw project state from workspace files and configurations.
 */
export function detectProjectEnvironment(): ProjectEnvironment {
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

/**
 * Step 3: Package Manager Resolution
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
 * Step 4: Runtime Resolution
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
  return resolveRuntime({ specifiedRuntime: undefined, bunVersion }, pm);
}

/**
 * Step 5: Version Resolution
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

  if (runtime === "bun") {
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

  if (pm.name === "bun") {
    return "";
  }

  core.info(`Node.js version not specified, using ${DEFAULT_NODE_VERSION}`);
  return DEFAULT_NODE_VERSION;
}

/**
 * Step 5: Version Resolution
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
 * Step 5: Version Resolution
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
  const project = detectProjectEnvironment();
  return resolvePackageManager(project);
}

/**
 * Legacy wrapper function for detecting Node.js version.
 */
export function detectNodeVersion(pmName?: string): string {
  const project = detectProjectEnvironment();
  const dummyPm = { name: pmName || "npm", version: "" };
  const runtime = pmName === "bun" ? "bun" : "node";
  return resolveNodeVersion({}, dummyPm, runtime, project);
}

/**
 * Legacy wrapper function for detecting Bun version.
 */
export function detectBunVersion(pm: PackageManager): string {
  const project = detectProjectEnvironment();
  return resolveBunVersion({}, pm, project);
}

/**
 * Step 6: Validation
 * Basic sanity check on resolved environment before returning.
 */
export function validateEnvironment(env: DetectedEnv): DetectedEnv {
  const rt = env.runtime as string;
  if (rt !== "node" && rt !== "bun") {
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
  return env;
}

/**
 * Formats the runtime argument for pnpm/setup based on detected Bun or Node.js versions.
 */
export function getPnpmRuntime(bunVersion: string, nodeVersion: string): string {
  if (bunVersion) {
    return `bun@${bunVersion}`;
  }
  if (nodeVersion && !nodeVersion.startsWith("lts")) {
    return `node@${nodeVersion}`;
  }
  return "node@lts";
}

/**
 * Writes the detected environment values to GitHub Actions outputs.
 */
export function writeOutput(
  nodeVersion: string,
  pm: PackageManager,
  bunVersion: string = "",
  runtime: "bun" | "node" = "node",
): void {
  core.setOutput("node-version", nodeVersion);
  core.setOutput("bun-version", bunVersion);
  core.setOutput("package-manager", pm.name);
  core.setOutput("package-manager-version", pm.version);
  core.setOutput("runtime", runtime);
  core.setOutput("pnpm-runtime", getPnpmRuntime(bunVersion, nodeVersion));
}

/**
 * Executes the full environment resolution pipeline:
 * Input Parsing -> Project Detection -> PM Resolution -> Runtime Resolution -> Version Resolution -> Validation -> Environment
 */
export function detectEnv(runtimeInput: string = core.getInput("runtime")): DetectedEnv {
  const parsedInputs = parseEnvironmentInputs(runtimeInput);
  const project = detectProjectEnvironment();
  const pm = resolvePackageManager(project);
  const runtime = resolveRuntime(parsedInputs, pm);
  const versions = resolveVersions(parsedInputs, pm, runtime, project);

  const env: DetectedEnv = {
    nodeVersion: versions.nodeVersion,
    bunVersion: versions.bunVersion,
    pm,
    runtime,
  };

  return validateEnvironment(env);
}

export function run(): void {
  const runtimeInput = core.getInput("runtime");
  const env = detectEnv(runtimeInput);
  writeOutput(env.nodeVersion, env.pm, env.bunVersion, env.runtime);
}

if (process.env.NODE_ENV !== "test") {
  run();
}
