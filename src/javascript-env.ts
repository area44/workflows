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

export interface JsProjectEnvironment {
  hasPackageJson: boolean;
  packageJson?: JsPackageManifest;
  packageJsonError?: string;
  packageJsonErrorType?: "read" | "parse";
  packageJsonErrorCause?: unknown;
  nvmRcVersion?: string;
  nvmRcError?: string;
  nodeFileVersion?: string;
  nodeFileError?: string;
  bunFileVersion?: string;
  bunFileError?: string;
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
}

export interface JsPackageManagerInfo {
  name: SupportedPackageManager;
  version: string;
}

export type Toolchain = "vite" | "vite-plus";
export type ToolchainInput = "auto" | "vite" | "vite-plus";

export interface JsInstallationPlan {
  packageManager: SupportedPackageManager;
  command: string;
  args: string[];
}

function isVitePlusKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "vite-plus" ||
    k === "@voidzero-dev/vite-plus" ||
    k === "@voidzero-dev/vite-plus-core" ||
    k.startsWith("@voidzero-dev/vite-plus-")
  );
}

function isVitePlusVal(val: unknown): boolean {
  if (typeof val !== "string") return false;
  const v = val.toLowerCase();
  return v.includes("@voidzero-dev/vite-plus") || v.includes("vite-plus-core");
}

function checkDepSectionForVitePlus(section?: Record<string, string>): boolean {
  if (!section || typeof section !== "object") return false;
  for (const [key, val] of Object.entries(section)) {
    if (typeof key === "string" && (isVitePlusKey(key) || isVitePlusVal(val))) {
      return true;
    }
  }
  return false;
}

function checkCatalogForVitePlus(pkg: any): boolean {
  const catalogObj = pkg.catalog || pkg.catalogs;
  if (!catalogObj || typeof catalogObj !== "object") return false;

  const catalogEntries = Array.isArray(catalogObj) ? catalogObj : Object.values(catalogObj);
  for (const entry of catalogEntries) {
    if (!entry || typeof entry !== "object") continue;
    for (const key of Object.keys(entry as Record<string, unknown>)) {
      if (typeof key === "string" && isVitePlusKey(key)) {
        return true;
      }
    }
  }
  return false;
}

export function hasVitePlusDependency(pkg?: JsPackageManifest): boolean {
  if (!pkg) return false;

  const depSections = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
    pkg.peerDependencies,
  ];

  for (const section of depSections) {
    if (checkDepSectionForVitePlus(section)) {
      return true;
    }
  }

  return checkCatalogForVitePlus(pkg);
}

export function resolveToolchain(
  toolchainInput?: string,
  project?: JsProjectEnvironment,
): Toolchain {
  if (toolchainInput) {
    const trimmed = toolchainInput.trim().toLowerCase();
    if (trimmed && trimmed !== "auto") {
      if (trimmed === "vite" || trimmed === "vite-plus") {
        return trimmed;
      }
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid toolchain input "${toolchainInput}". Supported values are "auto", "vite", or "vite-plus".`,
        { stage: "toolchain-resolution", input: toolchainInput },
      );
    }
  }

  if (project?.packageJson && hasVitePlusDependency(project.packageJson)) {
    return "vite-plus";
  }

  return "vite";
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
  packageJsonErrorType?: "read" | "parse";
  packageJsonErrorCause?: unknown;
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
      packageJsonError: `Failed to read package.json: ${msg}`,
      packageJsonErrorType: "read",
      packageJsonErrorCause: readErr,
    };
  }

  try {
    const packageJson = JSON.parse(rawContent);
    return { hasPackageJson: true, packageJson };
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return {
      hasPackageJson: true,
      packageJsonError: `Failed to parse package.json: ${msg}`,
      packageJsonErrorType: "parse",
      packageJsonErrorCause: parseErr,
    };
  }
}

function detectLockfiles(cwd: string): {
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
} {
  let hasPnpmLock = false;
  let hasPackageLock = false;
  let hasBunLock = false;

  try {
    hasPnpmLock = fs.existsSync(resolveFilePath("pnpm-lock.yaml", cwd));
    hasPackageLock = fs.existsSync(resolveFilePath("package-lock.json", cwd));
    hasBunLock = fs.existsSync(resolveFilePath("bun.lock", cwd));
  } catch {
    // Ignore detection errors
  }

  return { hasPnpmLock, hasPackageLock, hasBunLock };
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
    packageJsonErrorType: pkgInfo.packageJsonErrorType,
    packageJsonErrorCause: pkgInfo.packageJsonErrorCause,
    nvmRcVersion: nvmRc.version,
    nvmRcError: nvmRc.error,
    nodeFileVersion: nodeVersion.version,
    nodeFileError: nodeVersion.error,
    bunFileVersion: bunVersion.version,
    bunFileError: bunVersion.error,
    hasPnpmLock: lockfiles.hasPnpmLock,
    hasPackageLock: lockfiles.hasPackageLock,
    hasBunLock: lockfiles.hasBunLock,
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
  _project: JsProjectEnvironment,
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
      };
    }
    case "pnpm": {
      return {
        packageManager: "pnpm",
        command: "pnpm",
        args: ["install", "--no-frozen-lockfile"],
      };
    }
    case "bun": {
      return {
        packageManager: "bun",
        command: "bun",
        args: ["install"],
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
