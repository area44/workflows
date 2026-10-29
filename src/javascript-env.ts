import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";

export type SupportedRuntime = "node" | "bun";
export type SupportedPackageManager = "npm" | "pnpm" | "bun";

export interface PackageManager {
  name: string;
  source?: "packageManager" | "devEngines" | "lockfile" | "default";
}

export function isSupportedRuntime(runtime: string): runtime is SupportedRuntime {
  return runtime === "node" || runtime === "bun";
}

export function isSupportedPackageManager(pmName: string): pmName is SupportedPackageManager {
  return pmName === "npm" || pmName === "pnpm" || pmName === "bun";
}

export function validateRuntimePackageManagerCompatibility(runtime: string, pmName: string): void {
  if (!isSupportedRuntime(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Supported runtimes are: node, bun.`);
  }

  if (!isSupportedPackageManager(pmName)) {
    throw new Error(
      `Unsupported package manager "${pmName}". Supported package managers are: npm, pnpm, bun.`,
    );
  }

  if (runtime === "bun" && pmName === "npm") {
    throw new Error(
      `Unsupported runtime and package manager combination: Bun runtime does not support npm package manager. Bun runtime requires Bun or pnpm package manager.`,
    );
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
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
}

export interface JsPackageManagerInfo {
  name: SupportedPackageManager;
  source?: "packageManager" | "devEngines" | "lockfile" | "default";
}

export type Toolchain = "vite-plus" | undefined;
export type ToolchainInput = "auto" | "vite-plus";

export interface JsInstallationPlan {
  packageManager: SupportedPackageManager;
  command: string;
  args: string[];
}

export interface ResolvedJavaScriptEnvironment {
  detected: boolean;
  runtime: {
    name: "node" | "bun";
  };
  packageManager: {
    name: "npm" | "pnpm" | "bun";
  };
  toolchain?: "vite-plus";
}

interface RuntimeSignals {
  hasBunPm: boolean;
  hasBunDevEngine: boolean;
  hasNodeDevEngine: boolean;
}

export function hasDevEngineRuntime(
  pkg: JsPackageManifest | undefined,
  runtimeName: "node" | "bun",
): boolean {
  if (!pkg?.devEngines || typeof pkg.devEngines !== "object") return false;

  const devEngines = pkg.devEngines;

  if (devEngines[runtimeName] !== undefined && devEngines[runtimeName] !== null) {
    return true;
  }

  if (devEngines.runtime) {
    const runtimes = Array.isArray(devEngines.runtime) ? devEngines.runtime : [devEngines.runtime];

    for (const r of runtimes) {
      if (typeof r === "string") {
        const lower = r.trim().toLowerCase();
        if (
          lower === runtimeName ||
          lower.startsWith(`${runtimeName}@`) ||
          lower.startsWith(`${runtimeName}:`) ||
          lower.startsWith(`${runtimeName} `)
        ) {
          return true;
        }
      } else if (typeof r === "object" && r !== null) {
        const objName = (r as Record<string, unknown>).name;
        if (typeof objName === "string" && objName.trim().toLowerCase() === runtimeName) {
          return true;
        }
      }
    }
  }

  return false;
}

function collectRuntimeSignals(pm: PackageManager, project?: JsProjectEnvironment): RuntimeSignals {
  const pkg = project?.packageJson;
  const hasBunPm = pm.name === "bun";
  const hasBunDevEngine = hasDevEngineRuntime(pkg, "bun");
  const hasNodeDevEngine = hasDevEngineRuntime(pkg, "node");

  return {
    hasBunPm,
    hasBunDevEngine,
    hasNodeDevEngine,
  };
}

function validateRuntimeConflicts(signals: RuntimeSignals): void {
  const { hasBunPm, hasBunDevEngine, hasNodeDevEngine } = signals;

  if (hasBunDevEngine && hasNodeDevEngine) {
    throw new Error(
      "Conflicting runtime configuration in package.json devEngines: both Node.js and Bun runtimes are specified.",
    );
  }

  if (hasBunPm && hasNodeDevEngine) {
    throw new Error(
      "Conflicting runtime configuration: packageManager indicates Bun but package.json devEngines specifies Node.js runtime.",
    );
  }
}

/**
 * Runtime Resolution
 * Resolves target runtime based on package manager and project configuration.
 *
 * Precedence Rules:
 * 1. Validate all collected runtime signals for conflicts before applying precedence.
 * 2. Explicit `devEngines` runtime declarations in `package.json` (`devEngines.bun` vs `devEngines.node`).
 * 3. Package manager (`pm.name === "bun"` via `packageManager`, `devEngines.packageManager`, or `bun.lock`).
 * 4. Default fallback -> Node.js.
 */
export function resolveRuntime(pm: PackageManager, project?: JsProjectEnvironment): "node" | "bun" {
  const hasJsProject = Boolean(
    project?.hasPackageJson ||
    project?.hasPnpmLock ||
    project?.hasPackageLock ||
    project?.hasBunLock,
  );
  if (!hasJsProject) {
    return "node";
  }

  const signals = collectRuntimeSignals(pm, project);
  validateRuntimeConflicts(signals);

  if (signals.hasBunDevEngine) return "bun";
  if (signals.hasNodeDevEngine) return "node";
  if (signals.hasBunPm) return "bun";

  return "node";
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
): "vite-plus" | undefined {
  if (toolchainInput) {
    const trimmed = toolchainInput.trim().toLowerCase();
    if (trimmed && trimmed !== "auto") {
      if (trimmed === "vite-plus") {
        return "vite-plus";
      }
      throw new Error(
        'Invalid toolchain input: unsupported value. Supported values are "auto" or "vite-plus".',
      );
    }
  }

  if (project?.packageJson && hasVitePlusDependency(project.packageJson)) {
    return "vite-plus";
  }

  return undefined;
}

/**
 * Cohesive JavaScript environment resolution entry point.
 */
export function resolveJsEnvironment(
  toolchainInput?: string,
  cwd: string = process.cwd(),
): ResolvedJavaScriptEnvironment {
  const project = inspectJsProjectEnvironment(cwd);
  const pm = resolveJsPackageManager(project);
  const runtimeName = resolveRuntime(pm, project);
  const toolchain = resolveToolchain(toolchainInput, project);

  return {
    detected: project.hasPackageJson,
    runtime: {
      name: runtimeName,
    },
    packageManager: {
      name: pm.name as SupportedPackageManager,
    },
    toolchain,
  };
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
  const pkgInfo = inspectPackageJson(cwd);
  const lockfiles = detectLockfiles(cwd);

  return {
    hasPackageJson: pkgInfo.hasPackageJson,
    packageJson: pkgInfo.packageJson,
    packageJsonError: pkgInfo.packageJsonError,
    packageJsonErrorType: pkgInfo.packageJsonErrorType,
    packageJsonErrorCause: pkgInfo.packageJsonErrorCause,
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
    const name = rawName.trim().toLowerCase();
    if (isSupportedPackageManager(name)) {
      return { name };
    }
  } else if (typeof pm === "object" && pm !== null) {
    const obj = pm as Record<string, unknown>;
    if (typeof obj.name === "string" || typeof obj.name === "number") {
      const nameStr = String(obj.name).trim().toLowerCase();
      if (isSupportedPackageManager(nameStr)) {
        return { name: nameStr };
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

  return undefined;
}

function resolvePmFromPackageJson(project: JsProjectEnvironment): JsPackageManagerInfo | undefined {
  if (project.packageJsonError) {
    if (project.hasPackageJson) {
      core.warning(`Failed to detect package manager: ${project.packageJsonError}`);
    }
    return undefined;
  }

  if (!project.packageJson) {
    return undefined;
  }

  const pkg = project.packageJson;
  if (pkg.packageManager && typeof pkg.packageManager === "string") {
    const trimmed = pkg.packageManager.trim();
    const atIdx = trimmed.indexOf("@");
    const rawName = (atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed).trim();
    const name = rawName.toLowerCase();
    if (!isSupportedPackageManager(name)) {
      throw new Error(
        `Unsupported package manager '${rawName}'. Supported package managers are npm, pnpm, and bun.`,
      );
    }
    return { name, source: "packageManager" };
  }

  const devPm = getDevEnginePackageManager(pkg);
  if (devPm) {
    return { ...devPm, source: "devEngines" };
  }

  return undefined;
}

function resolvePmFromLockfiles(project: JsProjectEnvironment): JsPackageManagerInfo | undefined {
  const detectedLocks: Array<{ name: SupportedPackageManager; file: string }> = [];
  if (project.hasPnpmLock) detectedLocks.push({ name: "pnpm", file: "pnpm-lock.yaml" });
  if (project.hasPackageLock) detectedLocks.push({ name: "npm", file: "package-lock.json" });
  if (project.hasBunLock) detectedLocks.push({ name: "bun", file: "bun lockfile" });

  if (detectedLocks.length === 0) {
    return undefined;
  }

  if (detectedLocks.length > 1) {
    const fileList = detectedLocks.map((l) => l.file).join(", ");
    if (project.hasPackageJson) {
      core.warning(
        `Multiple conflicting lockfiles found (${fileList}). Selecting '${detectedLocks[0].file}' (${detectedLocks[0].name}) based on priority precedence.`,
      );
    }
  }

  const selected = detectedLocks[0];
  return { name: selected.name, source: "lockfile" };
}

export function resolveJsPackageManager(project: JsProjectEnvironment): JsPackageManagerInfo {
  const pkgPm = resolvePmFromPackageJson(project);
  if (pkgPm) {
    return pkgPm;
  }

  const lockPm = resolvePmFromLockfiles(project);
  if (lockPm) {
    return lockPm;
  }

  return { name: "npm", source: "default" };
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
