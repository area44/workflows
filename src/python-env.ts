import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

export type PythonPackageManager = "uv" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "pip",
] as const;

export const DEFAULT_PYTHON_VERSION = "3.12";

export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  ".git",
  ".venv",
  "venv",
  "env",
  ".env",
  "virtualenv",
  ".virtualenv",
  "conda-env",
  ".conda",
  "node_modules",
  "site-packages",
  "__pycache__",
  ".tox",
  ".nox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "dist",
  "build",
  ".egg-info",
  ".next",
  ".astro",
  "out",
  "vendor",
  ".yarn",
] as const;

export interface PythonInstallCommand {
  executable: string;
  args: string[];
}

export interface PythonPackageManagerInfo {
  name: PythonPackageManager;
  lockfile?: string;
  configFile?: string;
  installCommands: PythonInstallCommand[];
  lockCommand?: string;
  syncCommand?: string;
  execPrefix: string;
  isStandalone?: boolean;
}

export interface ResolvedPythonEnvironment {
  hasPythonSource: boolean;
  pythonVersion: string;
  ruffVersion: string;
  pmInfo: PythonPackageManagerInfo | null;
}

export interface ParsedTomlSuccess {
  success: true;
  data: Record<string, unknown>;
  rawContent?: string;
}

export interface ParsedTomlError {
  success: false;
  error: Error;
}

export type ParsedToml = ParsedTomlSuccess | ParsedTomlError;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Parses raw TOML content using smol-toml and explicitly classifies errors.
 */
export function parseToml(content: string): ParsedToml {
  try {
    const data = parse(content);
    if (isObject(data)) {
      return { success: true, data, rawContent: content };
    }
    return {
      success: false,
      error: new Error("Invalid TOML: root must be an object"),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Reads and parses pyproject.toml in cwd using parseToml.
 * Returns null if file does not exist, or ParsedToml result if file exists.
 */
export function readPyprojectToml(cwd: string = process.cwd()): ParsedToml | null {
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(pyprojectPath, "utf8");
    return parseToml(content);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export function parsePythonVersionFromConstraint(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^python-?/i, "")
    .replace(/['"]/g, "");
  const match = cleaned.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : undefined;
}

function readPythonVersionFile(cwd: string): string | undefined {
  const pythonVersionFile = path.join(cwd, ".python-version");
  if (!fs.existsSync(pythonVersionFile)) return undefined;
  try {
    const content = fs.readFileSync(pythonVersionFile, "utf8").trim();
    return parsePythonVersionFromConstraint(content);
  } catch {
    return undefined;
  }
}

function readPyprojectPythonVersion(
  cwd: string,
  pyprojectToml?: ParsedToml | null,
): string | undefined {
  const parsed = pyprojectToml !== undefined ? pyprojectToml : readPyprojectToml(cwd);
  if (parsed?.success !== true) return undefined;
  const project = parsed.data.project;
  if (isObject(project) && typeof project["requires-python"] === "string") {
    return parsePythonVersionFromConstraint(project["requires-python"]);
  }
  return undefined;
}

function readRuntimeTxtPythonVersion(cwd: string): string | undefined {
  const runtimeTxt = path.join(cwd, "runtime.txt");
  if (!fs.existsSync(runtimeTxt)) return undefined;
  try {
    const content = fs.readFileSync(runtimeTxt, "utf8").trim();
    return parsePythonVersionFromConstraint(content);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the target Python version from project configuration files (.python-version,
 * pyproject.toml, runtime.txt) or falls back to DEFAULT_PYTHON_VERSION.
 */
export function resolvePythonVersion(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): string {
  return (
    readPythonVersionFile(cwd) ||
    readPyprojectPythonVersion(cwd, pyprojectToml) ||
    readRuntimeTxtPythonVersion(cwd) ||
    DEFAULT_PYTHON_VERSION
  );
}

/**
 * Recursively checks if directory contains Python source files (.py or .pyi),
 * while skipping excluded dependency, cache, and build directories.
 */
export function hasPythonSource(
  cwd: string = process.cwd(),
  excludedDirs: readonly string[] = DEFAULT_EXCLUDED_DIRS,
): boolean {
  if (!fs.existsSync(cwd)) {
    return false;
  }

  const stack: string[] = [cwd];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      if (entry.isDirectory()) {
        if (excludedDirs.includes(name) || name.endsWith(".egg-info")) {
          continue;
        }
        stack.push(path.join(currentDir, name));
      } else if (entry.isFile()) {
        if (name.endsWith(".py") || name.endsWith(".pyi")) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasProjectTable(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (!isObject(parsed.project)) return false;
  const keys = Object.keys(parsed.project);
  if (keys.length === 0) return true;
  const subtableKeys = new Set([
    "optional-dependencies",
    "urls",
    "scripts",
    "gui-scripts",
    "entry-points",
  ]);
  const hasDirectProjectKeys = keys.some((k) => !subtableKeys.has(k));
  if (hasDirectProjectKeys) return true;

  // parsed.project contains ONLY subtable keys.
  // If rawContent is available, check whether an explicit [project] header is present.
  if (rawContent) {
    return /(?:^|\n)\s*\[\s*project\s*\]\s*(?:#.*)?(?:\n|$)/.test(rawContent);
  }
  return false;
}

function isUvProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  return (
    hasProjectTable(parsed, rawContent) ||
    isObject(parsed["build-system"]) ||
    (isObject(parsed.tool) &&
      isObject((parsed.tool as Record<string, unknown>).uv) &&
      isObject(((parsed.tool as Record<string, unknown>).uv as Record<string, unknown>).workspace))
  );
}

function isUvToolConfigPresent(parsed: Record<string, unknown>): boolean {
  return isObject(parsed.tool) && isObject((parsed.tool as Record<string, unknown>).uv);
}

function isPipProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  return hasProjectTable(parsed, rawContent) || isObject(parsed["build-system"]);
}

function detectUvLockedProject(hasValidPyproject: boolean): PythonPackageManagerInfo {
  if (!hasValidPyproject) {
    throw new Error(
      "Invalid Python project configuration: 'uv.lock' was detected without a valid 'pyproject.toml' project or workspace configuration ('[project]', '[build-system]', or '[tool.uv.workspace]'). 'uv sync' requires a valid 'pyproject.toml' file.",
    );
  }
  return {
    name: "uv",
    lockfile: "uv.lock",
    configFile: "pyproject.toml",
    installCommands: [{ executable: "uv", args: ["sync"] }],
    lockCommand: "uv lock",
    syncCommand: "uv sync",
    execPrefix: "uv run",
  };
}

function detectUv(cwd: string, pyprojectToml?: ParsedToml | null): PythonPackageManagerInfo | null {
  const hasUvLock = fs.existsSync(path.join(cwd, "uv.lock"));

  const hasValidPyproject =
    pyprojectToml?.success === true &&
    isUvProjectConfigPresent(pyprojectToml.data, pyprojectToml.rawContent);

  const hasUvToolConfig =
    pyprojectToml?.success === true && isUvToolConfigPresent(pyprojectToml.data);

  if (!hasUvLock && !hasUvToolConfig) return null;

  if (hasUvLock) {
    return detectUvLockedProject(hasValidPyproject);
  }

  // hasUvToolConfig is true without uv.lock
  const hasReqs = fs.existsSync(path.join(cwd, "requirements.txt"));
  if (hasReqs) {
    return {
      name: "uv",
      configFile: "pyproject.toml",
      installCommands: [{ executable: "uv", args: ["pip", "install", "-r", "requirements.txt"] }],
      execPrefix: "uv run",
    };
  }

  if (!hasValidPyproject) {
    return null;
  }

  return {
    name: "uv",
    configFile: "pyproject.toml",
    installCommands: [{ executable: "uv", args: ["sync"] }],
    lockCommand: "uv lock",
    syncCommand: "uv sync",
    execPrefix: "uv run",
  };
}

function detectPip(
  cwd: string,
  pyprojectToml?: ParsedToml | null,
): PythonPackageManagerInfo | null {
  const hasRequirements = fs.existsSync(path.join(cwd, "requirements.txt"));
  const hasSetupPy = fs.existsSync(path.join(cwd, "setup.py"));
  const hasSetupCfg = fs.existsSync(path.join(cwd, "setup.cfg"));
  const hasProjectOrBuildSystem =
    pyprojectToml?.success === true &&
    isPipProjectConfigPresent(pyprojectToml.data, pyprojectToml.rawContent);

  const isPipProject = hasRequirements || hasSetupPy || hasSetupCfg || hasProjectOrBuildSystem;
  if (!isPipProject) return null;

  let configFile: string | undefined;
  if (hasProjectOrBuildSystem) {
    configFile = "pyproject.toml";
  } else if (hasSetupPy) {
    configFile = "setup.py";
  } else if (hasSetupCfg) {
    configFile = "setup.cfg";
  }

  let installCommands: PythonInstallCommand[] = [];
  let lockfile: string | undefined;

  const isPackage = hasSetupPy || hasSetupCfg || hasProjectOrBuildSystem;

  if (hasRequirements && isPackage) {
    installCommands = [
      { executable: "pip", args: ["install", "-r", "requirements.txt"] },
      { executable: "pip", args: ["install", "-e", "."] },
    ];
    lockfile = "requirements.txt";
  } else if (hasRequirements) {
    installCommands = [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }];
    lockfile = "requirements.txt";
  } else if (isPackage) {
    installCommands = [{ executable: "pip", args: ["install", "-e", "."] }];
  }

  return {
    name: "pip",
    lockfile,
    configFile,
    installCommands,
    execPrefix: "",
  };
}

function inspectRuffInSpecifierArray(
  arr: unknown[],
): { declared: boolean; version?: string } | undefined {
  for (const item of arr) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (/^ruff\b/i.test(trimmed)) {
        return { declared: true, version: extractRuffVersionSpecifier(trimmed) };
      }
    } else if (isObject(item)) {
      const pkgName =
        typeof item.package === "string"
          ? item.package
          : typeof item.name === "string"
            ? item.name
            : undefined;
      if (pkgName && pkgName.toLowerCase() === "ruff") {
        const verStr = typeof item.version === "string" ? item.version : undefined;
        return {
          declared: true,
          version: verStr ? extractRuffVersionSpecifier(verStr) : undefined,
        };
      }
    }
  }
  return undefined;
}

function inspectRuffInDependencyMap(
  map: Record<string, unknown>,
): { declared: boolean; version?: string } | undefined {
  for (const [key, val] of Object.entries(map)) {
    if (key.toLowerCase() === "ruff") {
      if (typeof val === "string") {
        return { declared: true, version: extractRuffVersionSpecifier(val) };
      }
      if (isObject(val)) {
        const verStr = typeof val.version === "string" ? val.version : undefined;
        return {
          declared: true,
          version: verStr ? extractRuffVersionSpecifier(verStr) : undefined,
        };
      }
      return { declared: true };
    }
  }
  return undefined;
}

/**
 * Inspects pyproject.toml data strictly in supported dependency declarations
 * (PEP 621, PEP 735, tool.uv, Poetry, PDM, Hatch, Pixi, build-system).
 */
export function findRuffDependencyInToml(parsed: Record<string, unknown>): {
  declared: boolean;
  version?: string;
} {
  // 1. PEP 621 project.dependencies & project.optional-dependencies
  if (isObject(parsed.project)) {
    const proj = parsed.project;
    if (Array.isArray(proj.dependencies)) {
      const res = inspectRuffInSpecifierArray(proj.dependencies);
      if (res) return res;
    }
    if (isObject(proj["optional-dependencies"])) {
      for (const group of Object.values(proj["optional-dependencies"])) {
        if (Array.isArray(group)) {
          const res = inspectRuffInSpecifierArray(group);
          if (res) return res;
        }
      }
    }
  }

  // 2. PEP 735 dependency-groups
  if (isObject(parsed["dependency-groups"])) {
    for (const group of Object.values(parsed["dependency-groups"])) {
      if (Array.isArray(group)) {
        const res = inspectRuffInSpecifierArray(group);
        if (res) return res;
      }
    }
  }

  // 3. build-system.requires
  if (isObject(parsed["build-system"]) && Array.isArray(parsed["build-system"].requires)) {
    const res = inspectRuffInSpecifierArray(parsed["build-system"].requires);
    if (res) return res;
  }

  // 4. tool table
  if (isObject(parsed.tool)) {
    const tool = parsed.tool;

    // tool.uv
    if (isObject(tool.uv)) {
      const uv = tool.uv;
      for (const key of ["dev-dependencies", "override-dependencies", "constraint-dependencies"]) {
        if (Array.isArray(uv[key])) {
          const res = inspectRuffInSpecifierArray(uv[key] as unknown[]);
          if (res) return res;
        }
      }
    }

    // tool.poetry
    if (isObject(tool.poetry)) {
      const poetry = tool.poetry;
      if (isObject(poetry.dependencies)) {
        const res = inspectRuffInDependencyMap(poetry.dependencies);
        if (res) return res;
      }
      if (isObject(poetry["dev-dependencies"])) {
        const res = inspectRuffInDependencyMap(poetry["dev-dependencies"]);
        if (res) return res;
      }
      if (isObject(poetry.group)) {
        for (const grpObj of Object.values(poetry.group)) {
          if (isObject(grpObj) && isObject(grpObj.dependencies)) {
            const res = inspectRuffInDependencyMap(grpObj.dependencies);
            if (res) return res;
          }
        }
      }
    }

    // tool.pdm
    if (isObject(tool.pdm) && isObject(tool.pdm["dev-dependencies"])) {
      for (const grp of Object.values(tool.pdm["dev-dependencies"])) {
        if (Array.isArray(grp)) {
          const res = inspectRuffInSpecifierArray(grp);
          if (res) return res;
        }
      }
    }

    // tool.hatch
    if (isObject(tool.hatch) && isObject(tool.hatch.envs)) {
      for (const envObj of Object.values(tool.hatch.envs)) {
        if (isObject(envObj)) {
          if (Array.isArray(envObj.dependencies)) {
            const res = inspectRuffInSpecifierArray(envObj.dependencies);
            if (res) return res;
          }
          if (Array.isArray(envObj["extra-dependencies"])) {
            const res = inspectRuffInSpecifierArray(envObj["extra-dependencies"]);
            if (res) return res;
          }
        }
      }
    }

    // tool.pixi
    if (isObject(tool.pixi)) {
      const pixi = tool.pixi;
      if (isObject(pixi.dependencies)) {
        const res = inspectRuffInDependencyMap(pixi.dependencies);
        if (res) return res;
      }
      if (isObject(pixi["dev-dependencies"])) {
        const res = inspectRuffInDependencyMap(pixi["dev-dependencies"]);
        if (res) return res;
      }
      if (isObject(pixi.feature)) {
        for (const featObj of Object.values(pixi.feature)) {
          if (isObject(featObj)) {
            if (isObject(featObj.dependencies)) {
              const res = inspectRuffInDependencyMap(featObj.dependencies);
              if (res) return res;
            }
            if (isObject(featObj["dev-dependencies"])) {
              const res = inspectRuffInDependencyMap(featObj["dev-dependencies"]);
              if (res) return res;
            }
          }
        }
      }
    }
  }

  return { declared: false };
}

export function hasPythonProject(cwd: string = process.cwd()): boolean {
  if (hasPythonSource(cwd)) {
    return true;
  }

  const pyprojectToml = readPyprojectToml(cwd);
  if (pyprojectToml?.success === true) {
    if (isUvProjectConfigPresent(pyprojectToml.data, pyprojectToml.rawContent)) {
      return true;
    }
    if (isRuffDeclaredInProject(cwd, undefined, pyprojectToml)) {
      return true;
    }
  }

  const pyIndicatorFiles = ["setup.py", "setup.cfg", "requirements.txt", "uv.lock"];
  for (const f of pyIndicatorFiles) {
    if (fs.existsSync(path.join(cwd, f))) {
      return true;
    }
  }

  return false;
}

export function detectPythonPackageManager(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): PythonPackageManagerInfo | null {
  if (!hasPythonSource(cwd)) {
    return null;
  }

  const parsedToml = pyprojectToml !== undefined ? pyprojectToml : readPyprojectToml(cwd);

  const detected = detectUv(cwd, parsedToml) || detectPip(cwd, parsedToml);

  if (detected) {
    return detected;
  }

  // Standalone Python project without manifest or lockfile
  return {
    name: "pip",
    installCommands: [],
    execPrefix: "",
    isStandalone: true,
  };
}

export function extractRuffVersionSpecifier(raw: string): string | undefined {
  if (!raw) return undefined;
  let cleaned = raw
    .trim()
    .replace(/^ruff\b/i, "")
    .replace(/['"]/g, "")
    .trim();

  if (cleaned.startsWith("=") && !cleaned.startsWith("==")) {
    cleaned = cleaned.slice(1).trim();
  }

  if (!cleaned) return undefined;

  // Exact pin like ==0.4.2 or 0.4.2 or @0.4.2
  const exactMatch = cleaned.match(/^(?:==|@)?\s*(\d+\.\d+\.\d+(?:[a-z0-9_.-]+)?)$/i);
  if (exactMatch) {
    return exactMatch[1];
  }

  // Non-exact constraints or ranges like >=0.3.0,<0.5.0, ^0.4.0 return undefined so ruff-action uses standard version resolution without guessing
  return undefined;
}

function resolveRuffVersionFromUvLock(cwd: string): string | undefined {
  const uvLockPath = path.join(cwd, "uv.lock");
  if (!fs.existsSync(uvLockPath)) return undefined;
  try {
    const content = fs.readFileSync(uvLockPath, "utf8");
    const blocks = content.split(/^\[\[package\]\]/m);
    for (const block of blocks) {
      const nameMatch = block.match(/^\s*name\s*=\s*["']ruff["']/m);
      if (nameMatch) {
        const versionMatch = block.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
        if (versionMatch && versionMatch[1]) {
          return extractRuffVersionSpecifier(versionMatch[1]) || versionMatch[1];
        }
      }
    }
  } catch {
    // Ignore read error
  }
  return undefined;
}

function resolveRuffVersionFromPyproject(
  cwd: string,
  pyprojectToml?: ParsedToml | null,
): string | undefined {
  const parsed = pyprojectToml !== undefined ? pyprojectToml : readPyprojectToml(cwd);
  if (parsed?.success !== true) return undefined;
  const dep = findRuffDependencyInToml(parsed.data);
  return dep.version;
}

function resolveRuffVersionFromRequirements(cwd: string): string | undefined {
  const reqPath = path.join(cwd, "requirements.txt");
  if (!fs.existsSync(reqPath)) return undefined;
  try {
    const content = fs.readFileSync(reqPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/#.*/, "").trim();
      if (/^ruff\b/i.test(trimmed)) {
        const ver = extractRuffVersionSpecifier(trimmed);
        if (ver) return ver;
      }
    }
  } catch {
    // Ignore read error
  }
  return undefined;
}

export function resolveRuffVersion(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): string {
  return (
    resolveRuffVersionFromUvLock(cwd) ||
    resolveRuffVersionFromPyproject(cwd, pyprojectToml) ||
    resolveRuffVersionFromRequirements(cwd) ||
    ""
  );
}

export function isRuffDeclaredInProject(
  cwd: string = process.cwd(),
  pmInfo?: PythonPackageManagerInfo,
  pyprojectToml?: ParsedToml | null,
): boolean {
  if (pmInfo?.isStandalone) return false;

  const ver = resolveRuffVersion(cwd, pyprojectToml);
  if (ver) return true;

  const parsed = pyprojectToml !== undefined ? pyprojectToml : readPyprojectToml(cwd);
  if (parsed?.success === true) {
    const dep = findRuffDependencyInToml(parsed.data);
    if (dep.declared) {
      return true;
    }
  }

  const reqPath = path.join(cwd, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, "utf8");
      const stripped = content.replace(/#.*/g, "");
      if (/^\s*ruff\b/im.test(stripped)) {
        return true;
      }
    } catch {
      // Ignore read error
    }
  }

  return false;
}

/**
 * Cohesive Python environment resolution entry point.
 */
export function resolvePythonEnvironment(cwd: string = process.cwd()): ResolvedPythonEnvironment {
  const pySourcePresent = hasPythonSource(cwd);

  if (!pySourcePresent) {
    return {
      hasPythonSource: false,
      pythonVersion: "",
      ruffVersion: "",
      pmInfo: null,
    };
  }

  const pyprojectToml = readPyprojectToml(cwd);

  return {
    hasPythonSource: true,
    pythonVersion: resolvePythonVersion(cwd, pyprojectToml),
    ruffVersion: resolveRuffVersion(cwd, pyprojectToml),
    pmInfo: detectPythonPackageManager(cwd, pyprojectToml),
  };
}
