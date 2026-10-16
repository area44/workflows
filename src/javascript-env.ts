import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";

import { isSupportedPackageManager, type SupportedPackageManager } from "./compatibility.js";
import { WorkflowError } from "./errors.js";

/** Default npm fallback version */
// renovate: datasource=npm depName=npm
export const DEFAULT_NPM_VERSION = "12";

/** Default pnpm fallback version */
// renovate: datasource=npm depName=pnpm
export const DEFAULT_PNPM_VERSION = "12";

/** Default Bun fallback version */
// renovate: datasource=npm depName=bun
export const DEFAULT_BUN_VERSION = "1.4";

/** Default Node.js fallback version */
// renovate: datasource=node-version depName=node versioning=node
export const DEFAULT_NODE_VERSION = "24";

export function getDefaultJsPackageManagerVersion(pmName: string): string {
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

export interface JsPackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
  devEngines?: any;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export interface JsPackageJsonErrorInfo {
  type: "read" | "parse" | "unknown";
  message: string;
  cause?: unknown;
}

export interface JsProjectEnvironment {
  hasPackageJson: boolean;
  packageJson?: JsPackageManifest;
  packageJsonError?: string;
  packageJsonErrorInfo?: JsPackageJsonErrorInfo;
  nvmRcVersion?: string;
  nvmRcError?: string;
  nodeFileVersion?: string;
  nodeFileError?: string;
  bunFileVersion?: string;
  bunFileError?: string;
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
  bunLockFileName?: string;
}

export interface JsPackageManagerInfo {
  name: SupportedPackageManager;
  version: string;
}

export interface JsInstallationPlan {
  packageManager: SupportedPackageManager;
  command: string;
  args: string[];
  isFrozen: boolean;
  hasLockfile: boolean;
  lockfile?: string;
  reason: string;
}

export function sanitizePackageManager(pm: string): string {
  const clean = pm.trim().toLowerCase();
  if (/^[a-z0-9_.-]+$/.test(clean)) {
    return clean;
  }
  return "npm";
}

function resolveFilePath(filename: string, cwd: string): string {
  if (cwd === process.cwd()) {
    return filename;
  }
  return path.join(cwd, filename);
}

function readVersionFile(filename: string, cwd: string): { version?: string; error?: string } {
  const filePath = resolveFilePath(filename, cwd);
  try {
    if (fs.existsSync(filePath)) {
      return { version: fs.readFileSync(filePath, "utf8").trim() };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return {};
}

function inspectPackageJson(cwd: string): {
  hasPackageJson: boolean;
  packageJson?: JsPackageManifest;
  packageJsonError?: string;
  packageJsonErrorInfo?: JsPackageJsonErrorInfo;
} {
  const packageJsonPath = resolveFilePath("package.json", cwd);
  const hasPackageJson = fs.existsSync(packageJsonPath);
  if (!hasPackageJson) {
    return { hasPackageJson: false };
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(packageJsonPath, "utf8");
  } catch (readErr) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    return {
      hasPackageJson: true,
      packageJsonError: msg,
      packageJsonErrorInfo: {
        type: "read",
        message: `Failed to read package.json: ${msg}`,
        cause: readErr,
      },
    };
  }

  try {
    const packageJson = JSON.parse(rawContent);
    return { hasPackageJson: true, packageJson };
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return {
      hasPackageJson: true,
      packageJsonError: msg,
      packageJsonErrorInfo: {
        type: "parse",
        message: `Failed to parse package.json: ${msg}`,
        cause: parseErr,
      },
    };
  }
}

function detectLockfiles(cwd: string): {
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
  bunLockFileName?: string;
} {
  let hasPnpmLock = false;
  let hasPackageLock = false;
  let hasBunLock = false;
  let bunLockFileName: string | undefined;

  try {
    hasPnpmLock = fs.existsSync(resolveFilePath("pnpm-lock.yaml", cwd));
    hasPackageLock = fs.existsSync(resolveFilePath("package-lock.json", cwd));

    const bunLockPath = resolveFilePath("bun.lock", cwd);
    const bunLockbPath = resolveFilePath("bun.lockb", cwd);
    if (fs.existsSync(bunLockPath)) {
      hasBunLock = true;
      bunLockFileName = "bun.lock";
    } else if (fs.existsSync(bunLockbPath)) {
      hasBunLock = true;
      bunLockFileName = "bun.lockb";
    }
  } catch {
    // Ignore detection errors
  }

  return { hasPnpmLock, hasPackageLock, hasBunLock, bunLockFileName };
}

export function inspectJsProjectEnvironment(cwd: string = process.cwd()): JsProjectEnvironment {
  const nvmRc = readVersionFile(".nvmrc", cwd);
  const nodeVersion = readVersionFile(".node-version", cwd);
  const bunVersion = readVersionFile(".bun-version", cwd);
  const pkgInfo = inspectPackageJson(cwd);
  const lockfiles = detectLockfiles(cwd);

  return {
    hasPackageJson: pkgInfo.hasPackageJson,
    packageJson: pkgInfo.packageJson,
    packageJsonError: pkgInfo.packageJsonError,
    packageJsonErrorInfo: pkgInfo.packageJsonErrorInfo,
    nvmRcVersion: nvmRc.version,
    nvmRcError: nvmRc.error,
    nodeFileVersion: nodeVersion.version,
    nodeFileError: nodeVersion.error,
    bunFileVersion: bunVersion.version,
    bunFileError: bunVersion.error,
    hasPnpmLock: lockfiles.hasPnpmLock,
    hasPackageLock: lockfiles.hasPackageLock,
    hasBunLock: lockfiles.hasBunLock,
    bunLockFileName: lockfiles.bunLockFileName,
  };
}

function getDevEnginePackageManager(pkg: JsPackageManifest): JsPackageManagerInfo | undefined {
  if (!pkg.devEngines) return undefined;

  if (pkg.devEngines.packageManager) {
    const pm = Array.isArray(pkg.devEngines.packageManager)
      ? pkg.devEngines.packageManager[0]
      : pkg.devEngines.packageManager;

    if (typeof pm === "string") {
      const [name, version] = pm.split("@");
      if (isSupportedPackageManager(name)) {
        return { name, version: version || getDefaultJsPackageManagerVersion(name) };
      }
    } else if (typeof pm === "object" && pm !== null && pm.name) {
      if (isSupportedPackageManager(pm.name)) {
        return { name: pm.name, version: pm.version || getDefaultJsPackageManagerVersion(pm.name) };
      }
    }
  }

  for (const pm of ["pnpm", "npm", "bun"]) {
    if (pkg.devEngines[pm]) {
      if (!isSupportedPackageManager(pm)) continue;
      const val = pkg.devEngines[pm];
      const defaultVer = getDefaultJsPackageManagerVersion(pm);
      const version = typeof val === "string" ? val : val.version || defaultVer;
      return { name: pm, version };
    }
  }

  return undefined;
}

export function resolveJsPackageManager(project: JsProjectEnvironment): JsPackageManagerInfo {
  if (project.packageJsonError) {
    core.warning(`Failed to detect package manager: ${project.packageJsonError}`);
  } else if (project.packageJson) {
    const pkg = project.packageJson;
    if (pkg.packageManager && typeof pkg.packageManager === "string") {
      const [rawName, version] = pkg.packageManager.split("@");
      const name = rawName.toLowerCase();
      if (!isSupportedPackageManager(name)) {
        throw new WorkflowError(
          "UNSUPPORTED_RUNTIME_OR_PM",
          `Unsupported package manager '${rawName}'. Supported package managers are npm, pnpm, and bun.`,
          { resource: "packageManager", value: rawName },
        );
      }
      const pmVersion = version || getDefaultJsPackageManagerVersion(name);
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

export function getJsInstallationPlan(
  project: JsProjectEnvironment,
  pmInput: string | JsPackageManagerInfo,
): JsInstallationPlan {
  const pmNameRaw = typeof pmInput === "string" ? sanitizePackageManager(pmInput) : pmInput.name;

  if (!isSupportedPackageManager(pmNameRaw)) {
    throw new WorkflowError(
      "UNSUPPORTED_RUNTIME_OR_PM",
      `Unsupported package manager '${pmNameRaw}'. Supported package managers are npm, pnpm, and bun.`,
      { resource: "packageManager", value: pmNameRaw },
    );
  }

  const pmName: SupportedPackageManager = pmNameRaw;

  switch (pmName) {
    case "npm": {
      return {
        packageManager: "npm",
        command: "npm",
        args: ["install"],
        isFrozen: false,
        hasLockfile: project.hasPackageLock,
        lockfile: project.hasPackageLock ? "package-lock.json" : undefined,
        reason: "Installing dependencies with npm install to allow lockfile updates.",
      };
    }
    case "pnpm": {
      return {
        packageManager: "pnpm",
        command: "pnpm",
        args: ["install", "--no-frozen-lockfile"],
        isFrozen: false,
        hasLockfile: project.hasPnpmLock,
        lockfile: project.hasPnpmLock ? "pnpm-lock.yaml" : undefined,
        reason:
          "Installing dependencies with pnpm install --no-frozen-lockfile to allow lockfile updates.",
      };
    }
    case "bun": {
      return {
        packageManager: "bun",
        command: "bun",
        args: ["install"],
        isFrozen: false,
        hasLockfile: project.hasBunLock,
        lockfile: project.bunLockFileName,
        reason: "Installing dependencies with bun install to allow lockfile updates.",
      };
    }
  }
}

export function selectAutofixScripts(scripts?: Record<string, string>): string[] {
  if (!scripts) {
    return [];
  }

  if (scripts.check) {
    return ["check"];
  }
  if (scripts.format && scripts.lint) {
    return ["format", "lint"];
  }
  if (scripts.fmt && scripts.lint) {
    return ["fmt", "lint"];
  }
  if (scripts.format) {
    return ["format"];
  }
  if (scripts.fmt) {
    return ["fmt"];
  }
  if (scripts.lint) {
    return ["lint"];
  }

  return [];
}
