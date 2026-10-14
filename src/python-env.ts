import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

export interface PythonPackageManagerInfo {
  name: PythonPackageManager;
  lockfile?: string;
  configFile?: string;
  installCommand: string;
  lockCommand?: string;
  syncCommand?: string;
  execPrefix: string;
  isStandalone?: boolean;
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

function readPyprojectPythonVersion(cwd: string): string | undefined {
  const pyprojectFile = path.join(cwd, "pyproject.toml");
  if (!fs.existsSync(pyprojectFile)) return undefined;
  try {
    const content = fs.readFileSync(pyprojectFile, "utf8");
    const reqMatch = content.match(/requires-python\s*=\s*["']([^"']+)["']/i);
    if (reqMatch && reqMatch[1]) {
      return parsePythonVersionFromConstraint(reqMatch[1]);
    }
  } catch {
    // Ignore read errors
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
export function resolvePythonVersion(cwd: string = process.cwd()): string {
  return (
    readPythonVersionFile(cwd) ||
    readPyprojectPythonVersion(cwd) ||
    readRuntimeTxtPythonVersion(cwd) ||
    DEFAULT_PYTHON_VERSION
  );
}

export type RuffExecutionMode = "check" | "format-check" | "format" | "autofix";

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

export function isExecutableAvailable(binName: string): boolean {
  if (!binName || !/^[a-z0-9_.-]+$/i.test(binName)) {
    return false;
  }
  try {
    const cmd = process.platform === "win32" ? `where ${binName}` : `command -v ${binName}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasTomlTable(content: string, tableName: string): boolean {
  const escaped = tableName.replace(/\./g, "\\.");
  const pattern = new RegExp(`^\\s*\\[\\s*tool\\.${escaped}(?:\\.|\\s*\\])`, "m");
  return pattern.test(content);
}

function detectUv(cwd: string, pyprojectContent?: string): PythonPackageManagerInfo | null {
  const hasUvLock = fs.existsSync(path.join(cwd, "uv.lock"));
  const hasUvConfig = pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "uv");
  if (!hasUvLock && !hasUvConfig) return null;

  const hasReqs = fs.existsSync(path.join(cwd, "requirements.txt"));
  return {
    name: "uv",
    lockfile: hasUvLock ? "uv.lock" : undefined,
    configFile: hasUvConfig ? "pyproject.toml" : undefined,
    installCommand: hasUvLock
      ? "uv sync"
      : hasReqs
        ? "uv pip install -r requirements.txt"
        : "uv sync",
    lockCommand: "uv lock",
    syncCommand: "uv sync",
    execPrefix: "uv run",
  };
}

function detectPip(cwd: string, pyprojectContent?: string): PythonPackageManagerInfo | null {
  const hasRequirements = fs.existsSync(path.join(cwd, "requirements.txt"));
  const hasSetupPy = fs.existsSync(path.join(cwd, "setup.py"));
  const hasSetupCfg = fs.existsSync(path.join(cwd, "setup.cfg"));
  const hasProjectOrBuildSystem =
    pyprojectContent !== undefined &&
    /^\s*\[\s*(?:project|build-system)\s*\]/m.test(pyprojectContent);

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

  let installCommand = "pip install ruff";
  let lockfile: string | undefined;

  if (hasRequirements) {
    installCommand = "pip install -r requirements.txt";
    lockfile = "requirements.txt";
  } else if (hasSetupPy || hasSetupCfg || hasProjectOrBuildSystem) {
    installCommand = "pip install -e .";
  }

  return {
    name: "pip",
    lockfile,
    configFile,
    installCommand,
    execPrefix: "",
  };
}

export function detectPythonPackageManager(
  cwd: string = process.cwd(),
): PythonPackageManagerInfo | null {
  if (!hasPythonSource(cwd)) {
    return null;
  }

  let pyprojectContent: string | undefined;
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      pyprojectContent = fs.readFileSync(pyprojectPath, "utf8");
    } catch {
      // Ignore read errors
    }
  }

  const detected = detectUv(cwd, pyprojectContent) || detectPip(cwd, pyprojectContent);

  if (detected) {
    return detected;
  }

  // Standalone Python project without manifest or lockfile
  return {
    name: "pip",
    installCommand: "",
    execPrefix: "",
    isStandalone: true,
  };
}

function hasRuffInFile(filePath: string, pattern: RegExp): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return pattern.test(content);
  } catch {
    return false;
  }
}

export function isRuffDeclaredInProject(
  cwd: string = process.cwd(),
  pmInfo?: PythonPackageManagerInfo,
): boolean {
  if (pmInfo?.isStandalone) return false;

  return (
    hasRuffInFile(path.join(cwd, "pyproject.toml"), /\bruff\b/i) ||
    hasRuffInFile(path.join(cwd, "requirements.txt"), /^\s*ruff\b/im)
  );
}

export function getPythonRuffCommands(
  pmInfo: PythonPackageManagerInfo,
  mode: RuffExecutionMode = "autofix",
  cwd: string = process.cwd(),
): string[] {
  let prefix = "";

  if (isRuffDeclaredInProject(cwd, pmInfo)) {
    prefix = pmInfo.execPrefix ? `${pmInfo.execPrefix} ` : "";
  } else if (pmInfo.name === "uv" || isExecutableAvailable("uv")) {
    prefix = "uvx ";
  } else if (isExecutableAvailable("pipx")) {
    prefix = "pipx run ";
  } else {
    prefix = pmInfo.execPrefix ? `${pmInfo.execPrefix} ` : "";
  }

  switch (mode) {
    case "check":
      return [`${prefix}ruff check .`];
    case "format-check":
      return [`${prefix}ruff format --check .`];
    case "format":
      return [`${prefix}ruff format .`];
    case "autofix":
    default:
      return [`${prefix}ruff format .`, `${prefix}ruff check --fix .`];
  }
}
