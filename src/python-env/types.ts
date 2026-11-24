import fs from "node:fs";
import path from "node:path";

export type PythonPackageManager = "uv" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "pip",
] as const;

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
  detected: boolean;
  packageManager: PythonPackageManagerInfo | null;
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

export interface PythonProjectContext {
  cwd: string;
  projectDir: string;
  pyprojectToml: ParsedToml | null;
  pyprojectDir?: string;
  workspaceRootToml?: ParsedToml | null;
  workspaceRootDir?: string;
  uvToml: ParsedToml | null;
  uvTomlDir?: string;
  hasUvLock: boolean;
  uvLockDir?: string;
  hasRequirementsTxt: boolean;
  requirementsDir?: string;
  hasSetupPy: boolean;
  setupPyDir?: string;
  hasSetupCfg: boolean;
  setupCfgDir?: string;
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function isValidUvWorkspaceConfig(workspace: unknown): boolean {
  if (!isObject(workspace)) return false;
  if (!Array.isArray(workspace.members) || workspace.members.length === 0) return false;
  return workspace.members.every((m) => typeof m === "string");
}

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || normalized === "") {
    return /^$/;
  }
  let regexStr = "^";
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i++;
      continue;
    }
    if (char === "?") {
      regexStr += "[^/]";
      i++;
      continue;
    }
    if ("./+^$()|[]{}\\".includes(char)) {
      regexStr += "\\" + char;
      i++;
      continue;
    }
    regexStr += char;
    i++;
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

function isDirectoryMatchedByGlobs(relPath: string, globs: string[]): boolean {
  let normRelPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normRelPath === ".") {
    normRelPath = "";
  }
  for (const glob of globs) {
    if (globToRegex(glob).test(normRelPath)) {
      return true;
    }
  }
  return false;
}

export function isWorkspaceMember(
  wsRootDir: string,
  childDir: string,
  workspaceConfig: Record<string, unknown>,
): boolean {
  const resolvedWsRoot = path.resolve(wsRootDir);
  const resolvedChild = path.resolve(childDir);
  const relPath = path.relative(resolvedWsRoot, resolvedChild).replace(/\\/g, "/");

  if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
    return false;
  }

  const members = Array.isArray(workspaceConfig.members)
    ? workspaceConfig.members.filter((m): m is string => typeof m === "string")
    : [];

  const excludes = Array.isArray(workspaceConfig.exclude)
    ? workspaceConfig.exclude.filter((e): e is string => typeof e === "string")
    : [];

  const effectiveRelPath = relPath === "" ? "." : relPath;

  if (excludes.length > 0 && isDirectoryMatchedByGlobs(effectiveRelPath, excludes)) {
    return false;
  }

  if (!isDirectoryMatchedByGlobs(effectiveRelPath, members)) {
    return false;
  }

  if (resolvedChild !== resolvedWsRoot) {
    if (!fs.existsSync(path.join(resolvedChild, "pyproject.toml"))) {
      return false;
    }
  }

  return true;
}
