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

function hasNodeEngine(): boolean {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      return getDevEngineRuntimeVersion(pkg, "node") !== undefined;
    }
  } catch {
    // Ignore detection errors
  }
  return false;
}

function hasBunEngine(): boolean {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      return getDevEngineRuntimeVersion(pkg, "bun") !== undefined;
    }
  } catch {
    // Ignore detection errors
  }
  return false;
}

/**
 * Detects Node.js version based on project configuration files.
 *
 * Precedence:
 * 1. `.nvmrc`
 * 2. `.node-version`
 * 3. `package.json` -> `devEngines.runtime` / `devEngines.node`
 * 4. Empty string if package manager is bun and no explicit Node configuration exists.
 * 5. Fallback: DEFAULT_NODE_VERSION ("24").
 */
export function detectNodeVersion(pmName?: string): string {
  try {
    if (fs.existsSync(".nvmrc")) {
      const version = fs.readFileSync(".nvmrc", "utf8").trim();
      core.info(`Found .nvmrc: ${version}`);
      return version;
    }
    if (fs.existsSync(".node-version")) {
      const version = fs.readFileSync(".node-version", "utf8").trim();
      core.info(`Found .node-version: ${version}`);
      return version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const devVersion = getDevEngineRuntimeVersion(pkg, "node");
      if (devVersion) {
        core.info(`Found Node.js version in package.json devEngines: ${devVersion}`);
        return devVersion;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect Node.js version: ${message}`);
  }
  if (
    pmName === "bun" &&
    !hasNodeEngine() &&
    !fs.existsSync(".nvmrc") &&
    !fs.existsSync(".node-version")
  ) {
    return "";
  }
  core.info(`Node.js version not specified, using ${DEFAULT_NODE_VERSION}`);
  return DEFAULT_NODE_VERSION;
}

/**
 * Detects the package manager and its version from package.json, devEngines, or lockfiles.
 *
 * Precedence:
 * 1. `package.json` -> `packageManager` (e.g. `"pnpm@11.21.0"` or `"bun"`)
 * 2. `package.json` -> `devEngines.packageManager` or `devEngines[pm]`
 * 3. Lockfiles in priority order:
 *    a. `pnpm-lock.yaml` -> pnpm
 *    b. `package-lock.json` -> npm
 *    c. `bun.lock` / `bun.lockb` -> bun
 * 4. Fallback: npm@DEFAULT_NPM_VERSION ("12").
 */
export function detectPackageManager(): PackageManager {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split("@");
        const pmVersion = version || getDefaultPackageManagerVersion(name);
        core.info(`Found packageManager in package.json: ${name}@${pmVersion}`);
        return { name, version: pmVersion };
      }

      const devPm = getDevEnginePackageManager(pkg);
      if (devPm) {
        core.info(
          `Found packageManager in package.json devEngines: ${devPm.name}@${devPm.version}`,
        );
        return devPm;
      }
    }

    if (fs.existsSync("pnpm-lock.yaml")) {
      core.info(`Found pnpm-lock.yaml, using pnpm@${DEFAULT_PNPM_VERSION}`);
      return { name: "pnpm", version: DEFAULT_PNPM_VERSION };
    }
    if (fs.existsSync("package-lock.json")) {
      core.info(`Found package-lock.json, using npm@${DEFAULT_NPM_VERSION}`);
      return { name: "npm", version: DEFAULT_NPM_VERSION };
    }
    if (fs.existsSync("bun.lock") || fs.existsSync("bun.lockb")) {
      core.info(`Found bun lockfile, using bun@${DEFAULT_BUN_VERSION}`);
      return { name: "bun", version: DEFAULT_BUN_VERSION };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect package manager: ${message}`);
  }
  core.info(`Package manager not specified, using npm@${DEFAULT_NPM_VERSION}`);
  return { name: "npm", version: DEFAULT_NPM_VERSION };
}

/**
 * Detects Bun version based on configuration and package manager.
 *
 * Precedence:
 * 1. `.bun-version`
 * 2. `pm.version` if package manager is bun and version is not "latest"
 * 3. `package.json` -> `devEngines.runtime` / `devEngines.bun`
 * 4. Fallback DEFAULT_BUN_VERSION ("1.4") if Bun lockfile, package manager bun, or Bun devEngine is present
 * 5. Fallback: empty string ("").
 */
export function detectBunVersion(pm: PackageManager): string {
  try {
    if (fs.existsSync(".bun-version")) {
      const version = fs.readFileSync(".bun-version", "utf8").trim();
      core.info(`Found .bun-version: ${version}`);
      return version;
    }
    if (pm.name === "bun" && pm.version && pm.version !== "latest") {
      return pm.version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const devVersion = getDevEngineRuntimeVersion(pkg, "bun");
      if (devVersion) {
        core.info(`Found Bun version in package.json devEngines: ${devVersion}`);
        return devVersion;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect Bun version: ${message}`);
  }

  const isBunDetected =
    pm.name === "bun" || fs.existsSync("bun.lock") || fs.existsSync("bun.lockb") || hasBunEngine();

  if (isBunDetected) {
    return DEFAULT_BUN_VERSION;
  }

  return "";
}

/**
 * Parses the explicit `runtime` input option (e.g. "node@24", "bun@1.4", "node@24,bun@1.4", or "both").
 */
export function parseRuntimeInput(runtimeInput: string): {
  specifiedRuntime?: "node" | "bun";
  nodeVersion?: string;
  bunVersion?: string;
} {
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

/**
 * Resolves the target runtime ("node" or "bun") given a package manager and bun version.
 */
export function detectRuntime(pm: PackageManager, bunVersion: string): "node" | "bun" {
  if (pm.name === "bun" || Boolean(bunVersion)) {
    return "bun";
  }
  return "node";
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
 * Performs full environment detection according to the Environment Contract rules.
 *
 * Precedence summary:
 * 1. Runtime input string parsing (highest override power for versions and runtime choice)
 * 2. Package manager resolution (`packageManager` field > `devEngines` > lockfiles > npm@12)
 * 3. Bun version resolution (`.bun-version` > PM version > `devEngines` > lockfile fallback)
 * 4. Node.js version resolution (`.nvmrc` > `.node-version` > `devEngines` > fallback)
 */
export function detectEnv(runtimeInput: string = core.getInput("runtime")): DetectedEnv {
  const parsed = parseRuntimeInput(runtimeInput);
  const pm = detectPackageManager();
  const detectedBunVer = detectBunVersion(pm);

  let runtime: "node" | "bun";
  if (parsed.specifiedRuntime) {
    runtime = parsed.specifiedRuntime;
  } else if (pm.name === "bun") {
    runtime = "bun";
  } else {
    runtime = "node";
  }

  const detectedNodeVer = detectNodeVersion(runtime === "bun" ? "bun" : pm.name);

  const bunVer = parsed.bunVersion ?? detectedBunVer;
  const nodeVer =
    parsed.nodeVersion ?? (runtime === "bun" && !parsed.nodeVersion ? "" : detectedNodeVer);

  return {
    nodeVersion: nodeVer,
    bunVersion: bunVer,
    pm,
    runtime,
  };
}

export function run(): void {
  const runtimeInput = core.getInput("runtime");
  const env = detectEnv(runtimeInput);
  writeOutput(env.nodeVersion, env.pm, env.bunVersion, env.runtime);
}

if (process.env.NODE_ENV !== "test") {
  run();
}
