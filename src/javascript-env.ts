import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";

export type SupportedPackageManager = "npm" | "pnpm" | "bun";

export function isSupportedPackageManager(pmName: string): pmName is SupportedPackageManager {
  return pmName === "npm" || pmName === "pnpm" || pmName === "bun";
}

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
      throw new Error(
        `Invalid toolchain input "${toolchainInput}". Supported values are "auto", "vite", or "vite-plus".`,
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

function parseDevEnginePmItem(pm: unknown): JsPackageManagerInfo | undefined {
  if (typeof pm === "string") {
    const trimmed = pm.trim();
    if (!trimmed) return undefined;
    const atIdx = trimmed.indexOf("@");
    const rawName = atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed;
    const rawVer = atIdx !== -1 ? trimmed.slice(atIdx + 1) : "";
    const name = rawName.trim().toLowerCase();
    if (isSupportedPackageManager(name)) {
      const version = rawVer.trim() || getDefaultJsPackageManagerVersion(name);
      return { name, version };
    }
  } else if (typeof pm === "object" && pm !== null) {
    const obj = pm as Record<string, unknown>;
    if (typeof obj.name === "string" || typeof obj.name === "number") {
      const nameStr = String(obj.name).trim().toLowerCase();
      if (isSupportedPackageManager(nameStr)) {
        const verStr =
          typeof obj.version === "string" || typeof obj.version === "number"
            ? String(obj.version).trim()
            : "";
        const version = verStr || getDefaultJsPackageManagerVersion(nameStr);
        return { name: nameStr, version };
      }
    }
  }
  return undefined;
}

function parseDevEnginePmNamedSection(pkg: JsPackageManifest): JsPackageManagerInfo | undefined {
  if (!pkg.devEngines || typeof pkg.devEngines !== "object") return undefined;
  for (const pm of ["pnpm", "npm", "bun"] as const) {
    if (pkg.devEngines[pm] !== undefined && pkg.devEngines[pm] !== null) {
      const val = pkg.devEngines[pm];
      const defaultVer = getDefaultJsPackageManagerVersion(pm);
      if (typeof val === "string") {
        const trimmed = val.trim();
        return { name: pm, version: trimmed || defaultVer };
      } else if (typeof val === "object" && val !== null) {
        const ver =
          (val as any).version !== undefined && (val as any).version !== null
            ? String((val as any).version).trim()
            : "";
        return { name: pm, version: ver || defaultVer };
      }
    }
  }
  return undefined;
}

function getDevEnginePackageManager(pkg: JsPackageManifest): JsPackageManagerInfo | undefined {
  if (!pkg.devEngines || typeof pkg.devEngines !== "object") return undefined;

  if (pkg.devEngines.packageManager) {
    const pmList = Array.isArray(pkg.devEngines.packageManager)
      ? pkg.devEngines.packageManager
      : [pkg.devEngines.packageManager];

    for (const pm of pmList) {
      const parsed = parseDevEnginePmItem(pm);
      if (parsed) return parsed;
    }
  }

  return parseDevEnginePmNamedSection(pkg);
}

function parseDevEngineRuntimeString(
  trimmed: string,
  runtimeName: "node" | "bun",
  defaultVersion: string,
): string | undefined {
  const lower = trimmed.toLowerCase();
  if (lower === runtimeName) {
    return defaultVersion;
  }
  if (
    lower.startsWith(`${runtimeName}@`) ||
    lower.startsWith(`${runtimeName}:`) ||
    lower.startsWith(`${runtimeName} `)
  ) {
    const ver = trimmed.slice(runtimeName.length + 1).trim();
    return ver || defaultVersion;
  }
  return undefined;
}

function parseDevEngineRuntimeItem(
  item: unknown,
  runtimeName: "node" | "bun",
  defaultVersion: string,
): string | undefined {
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return undefined;
    return parseDevEngineRuntimeString(trimmed, runtimeName, defaultVersion);
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.name === "string" || typeof obj.name === "number") {
      const nameStr = String(obj.name).trim().toLowerCase();
      if (nameStr === runtimeName) {
        const verStr =
          typeof obj.version === "string" || typeof obj.version === "number"
            ? String(obj.version).trim()
            : "";
        return verStr || defaultVersion;
      }
    }
  }
  return undefined;
}

export function getDevEngineRuntimeVersion(
  pkg: JsPackageManifest | undefined,
  runtimeName: "node" | "bun",
): string | undefined {
  if (!pkg?.devEngines || typeof pkg.devEngines !== "object") return undefined;

  const defaultVersion = runtimeName === "bun" ? DEFAULT_BUN_VERSION : DEFAULT_NODE_VERSION;

  if (pkg.devEngines.runtime) {
    const runtimes = Array.isArray(pkg.devEngines.runtime)
      ? pkg.devEngines.runtime
      : [pkg.devEngines.runtime];
    for (const r of runtimes) {
      const parsed = parseDevEngineRuntimeItem(r, runtimeName, defaultVersion);
      if (parsed !== undefined) return parsed;
    }
  }

  const directEngine = pkg.devEngines[runtimeName];
  if (typeof directEngine === "string") {
    const trimmed = directEngine.trim();
    if (!trimmed) return undefined;
    const parsed = parseDevEngineRuntimeString(trimmed, runtimeName, defaultVersion);
    return parsed || trimmed;
  }
  if (typeof directEngine === "object" && directEngine !== null) {
    const ver =
      (directEngine as any).version !== undefined && (directEngine as any).version !== null
        ? String((directEngine as any).version).trim()
        : "";
    return ver || defaultVersion;
  }

  return undefined;
}

export function resolveJsPackageManager(project: JsProjectEnvironment): JsPackageManagerInfo {
  if (project.packageJsonError) {
    core.warning(`Failed to detect package manager: ${project.packageJsonError}`);
  } else if (project.packageJson) {
    const pkg = project.packageJson;
    if (pkg.packageManager && typeof pkg.packageManager === "string") {
      const trimmed = pkg.packageManager.trim();
      const atIdx = trimmed.indexOf("@");
      const rawName = (atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed).trim();
      const rawVersion = (atIdx !== -1 ? trimmed.slice(atIdx + 1) : "").trim();
      const name = rawName.toLowerCase();
      if (!isSupportedPackageManager(name)) {
        throw new Error(
          `Unsupported package manager '${rawName}'. Supported package managers are npm, pnpm, and bun.`,
        );
      }
      const pmVersion = rawVersion || getDefaultJsPackageManagerVersion(name);
      core.info(`Found packageManager in package.json: ${name}@${pmVersion}`);
      return { name, version: pmVersion };
    }

    const devPm = getDevEnginePackageManager(pkg);
    if (devPm) {
      core.info(`Found packageManager in package.json devEngines: ${devPm.name}@${devPm.version}`);
      return devPm;
    }
  }

  const detectedLocks: Array<{ name: SupportedPackageManager; file: string; version: string }> = [];
  if (project.hasPnpmLock)
    detectedLocks.push({ name: "pnpm", file: "pnpm-lock.yaml", version: DEFAULT_PNPM_VERSION });
  if (project.hasPackageLock)
    detectedLocks.push({ name: "npm", file: "package-lock.json", version: DEFAULT_NPM_VERSION });
  if (project.hasBunLock)
    detectedLocks.push({ name: "bun", file: "bun lockfile", version: DEFAULT_BUN_VERSION });

  if (detectedLocks.length > 0) {
    if (detectedLocks.length > 1) {
      const fileList = detectedLocks.map((l) => l.file).join(", ");
      core.warning(
        `Multiple conflicting lockfiles found (${fileList}). Selecting '${detectedLocks[0].file}' (${detectedLocks[0].name}) based on priority precedence.`,
      );
    }
    const selected = detectedLocks[0];
    core.info(`Found ${selected.file}, using ${selected.name}@${selected.version}`);
    return { name: selected.name, version: selected.version };
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
    throw new Error(
      `Unsupported package manager '${pmNameRaw}'. Supported package managers are npm, pnpm, and bun.`,
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
