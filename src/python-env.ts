import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type PythonPackageManager = "uv" | "poetry" | "pdm" | "pipenv" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "poetry",
  "pdm",
  "pipenv",
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

/**
 * Resolves the target Python version from project configuration files (.python-version,
 * pyproject.toml, Pipfile, runtime.txt) or falls back to DEFAULT_PYTHON_VERSION.
 */
export function resolvePythonVersion(cwd: string = process.cwd()): string {
  // 1. Check .python-version
  const pythonVersionFile = path.join(cwd, ".python-version");
  if (fs.existsSync(pythonVersionFile)) {
    try {
      const content = fs.readFileSync(pythonVersionFile, "utf8").trim();
      const ver = parsePythonVersionFromConstraint(content);
      if (ver) return ver;
    } catch {
      // Ignore read errors
    }
  }

  // 2. Check pyproject.toml
  const pyprojectFile = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectFile)) {
    try {
      const content = fs.readFileSync(pyprojectFile, "utf8");
      // PEP 621 or PDM: requires-python = ">=3.11"
      const reqMatch = content.match(/requires-python\s*=\s*["']([^"']+)["']/i);
      if (reqMatch && reqMatch[1]) {
        const ver = parsePythonVersionFromConstraint(reqMatch[1]);
        if (ver) return ver;
      }
      // Poetry: python = "^3.11"
      const poetryMatch = content.match(
        /\[tool\.poetry\.dependencies\][^[]*?\bpython\s*=\s*["']([^"']+)["']/s,
      );
      if (poetryMatch && poetryMatch[1]) {
        const ver = parsePythonVersionFromConstraint(poetryMatch[1]);
        if (ver) return ver;
      }
    } catch {
      // Ignore read errors
    }
  }

  // 3. Check Pipfile
  const pipfile = path.join(cwd, "Pipfile");
  if (fs.existsSync(pipfile)) {
    try {
      const content = fs.readFileSync(pipfile, "utf8");
      const match = content.match(/python_version\s*=\s*["']([^"']+)["']/i);
      if (match && match[1]) {
        const ver = parsePythonVersionFromConstraint(match[1]);
        if (ver) return ver;
      }
    } catch {
      // Ignore read errors
    }
  }

  // 4. Check runtime.txt
  const runtimeTxt = path.join(cwd, "runtime.txt");
  if (fs.existsSync(runtimeTxt)) {
    try {
      const content = fs.readFileSync(runtimeTxt, "utf8").trim();
      const ver = parsePythonVersionFromConstraint(content);
      if (ver) return ver;
    } catch {
      // Ignore read errors
    }
  }

  return DEFAULT_PYTHON_VERSION;
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

function detectPoetry(cwd: string, pyprojectContent?: string): PythonPackageManagerInfo | null {
  const hasPoetryLock = fs.existsSync(path.join(cwd, "poetry.lock"));
  const hasPoetryConfig =
    pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "poetry");
  if (!hasPoetryLock && !hasPoetryConfig) return null;

  return {
    name: "poetry",
    lockfile: hasPoetryLock ? "poetry.lock" : undefined,
    configFile: hasPoetryConfig ? "pyproject.toml" : undefined,
    installCommand: "poetry install",
    lockCommand: "poetry lock --no-update",
    syncCommand: "poetry install",
    execPrefix: "poetry run",
  };
}

function detectPdm(cwd: string, pyprojectContent?: string): PythonPackageManagerInfo | null {
  const hasPdmLock = fs.existsSync(path.join(cwd, "pdm.lock"));
  const hasPdmConfig = pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "pdm");
  if (!hasPdmLock && !hasPdmConfig) return null;

  return {
    name: "pdm",
    lockfile: hasPdmLock ? "pdm.lock" : undefined,
    configFile: hasPdmConfig ? "pyproject.toml" : undefined,
    installCommand: "pdm install",
    lockCommand: "pdm lock",
    syncCommand: "pdm install",
    execPrefix: "pdm run",
  };
}

function detectPipenv(cwd: string): PythonPackageManagerInfo | null {
  const hasPipfileLock = fs.existsSync(path.join(cwd, "Pipfile.lock"));
  const hasPipfile = fs.existsSync(path.join(cwd, "Pipfile"));
  if (!hasPipfileLock && !hasPipfile) return null;

  return {
    name: "pipenv",
    lockfile: hasPipfileLock ? "Pipfile.lock" : undefined,
    configFile: "Pipfile",
    installCommand: "pipenv install --dev",
    lockCommand: "pipenv lock",
    syncCommand: "pipenv install --dev",
    execPrefix: "pipenv run",
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

  const detected =
    detectUv(cwd, pyprojectContent) ||
    detectPoetry(cwd, pyprojectContent) ||
    detectPdm(cwd, pyprojectContent) ||
    detectPipenv(cwd) ||
    detectPip(cwd, pyprojectContent);

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

export function isRuffDeclaredInProject(
  cwd: string = process.cwd(),
  pmInfo?: PythonPackageManagerInfo,
): boolean {
  if (pmInfo?.isStandalone) return false;

  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf8");
      if (/\bruff\b/i.test(content)) {
        return true;
      }
    } catch {
      // Ignore read error
    }
  }

  const reqPath = path.join(cwd, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, "utf8");
      if (/^\s*ruff\b/im.test(content)) {
        return true;
      }
    } catch {
      // Ignore read error
    }
  }

  const pipfilePath = path.join(cwd, "Pipfile");
  if (fs.existsSync(pipfilePath)) {
    try {
      const content = fs.readFileSync(pipfilePath, "utf8");
      if (/\bruff\b/i.test(content)) {
        return true;
      }
    } catch {
      // Ignore read error
    }
  }

  return false;
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
