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

  let installCommand = "";
  let lockfile: string | undefined;

  const isPackage = hasSetupPy || hasSetupCfg || hasProjectOrBuildSystem;

  if (hasRequirements && isPackage) {
    installCommand = "pip install -r requirements.txt && pip install -e .";
    lockfile = "requirements.txt";
  } else if (hasRequirements) {
    installCommand = "pip install -r requirements.txt";
    lockfile = "requirements.txt";
  } else if (isPackage) {
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

export function extractRuffVersionSpecifier(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/^ruff\s*/i, "").replace(/['"]/g, "");
  if (!cleaned) return undefined;

  // Exact pin like ==0.4.2 or 0.4.2 or @0.4.2
  const exactMatch = cleaned.match(/^(?:==|@)?\s*(\d+\.\d+\.\d+(?:[a-z0-9_.-]+)?)$/i);
  if (exactMatch) {
    return exactMatch[1];
  }

  // Exact version digits inside constraints like ==0.4.2, ^0.4.0, ~=0.4.1
  const versionMatch = cleaned.match(/(?:==|~=|\^)?\s*(\d+\.\d+\.\d+)/);
  if (versionMatch) {
    return versionMatch[1];
  }

  return undefined;
}

export function resolveRuffVersion(cwd: string = process.cwd()): string {
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf8");
      const stripped = content
        .replace(/#.*/g, "")
        .replace(/\[\s*tool\.ruff(?:\.[^\]]+)?\s*\][\s\S]*?(?=\n\s*\[|$)/gi, "");

      const arrayMatch = stripped.match(/["'](ruff(?:[<>=~^!].*?|))["']/i);
      if (arrayMatch && arrayMatch[1] && arrayMatch[1].toLowerCase().startsWith("ruff")) {
        const ver = extractRuffVersionSpecifier(arrayMatch[1]);
        if (ver) return ver;
      }

      const keyValMatch = stripped.match(/^\s*ruff\s*=\s*["']([^"']+)["']/im);
      if (keyValMatch && keyValMatch[1]) {
        const ver = extractRuffVersionSpecifier(keyValMatch[1]);
        if (ver) return ver;
      }
    } catch {
      // Ignore read error
    }
  }

  const reqPath = path.join(cwd, "requirements.txt");
  if (fs.existsSync(reqPath)) {
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
  }

  return "";
}

export function isRuffDeclaredInProject(
  cwd: string = process.cwd(),
  pmInfo?: PythonPackageManagerInfo,
): boolean {
  if (pmInfo?.isStandalone) return false;

  const ver = resolveRuffVersion(cwd);
  if (ver) return true;

  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf8");
      const stripped = content
        .replace(/#.*/g, "")
        .replace(/\[\s*tool\.ruff(?:\.[^\]]+)?\s*\][\s\S]*?(?=\n\s*\[|$)/gi, "");
      if (/\bruff\b/i.test(stripped)) {
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

export function getPythonBinary(): string {
  if (isExecutableAvailable("python3")) return "python3";
  if (isExecutableAvailable("python")) return "python";
  return "python3";
}

export function ensureRuffAvailable(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
  checkExec: (bin: string) => boolean = isExecutableAvailable,
): void {
  if (checkExec("ruff") || checkExec("uvx") || checkExec("uv") || checkExec("pipx")) {
    return;
  }

  const pyBin = getPythonBinary();
  try {
    execSync(`${pyBin} -m ruff --version`, { stdio: "ignore" });
    return;
  } catch {
    // Not installed yet
  }

  try {
    execSync(`${pyBin} -m pip install ruff`, { stdio: "inherit", cwd });
  } catch (err) {
    try {
      execSync("pip install ruff", { stdio: "inherit", cwd });
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(`Failed to install Ruff in Python environment: ${msg}`);
    }
  }
}

export function getPythonRuffCommands(
  pmInfo: PythonPackageManagerInfo,
  mode: RuffExecutionMode = "autofix",
  cwd: string = process.cwd(),
  checkExec: (bin: string) => boolean = isExecutableAvailable,
): string[] {
  let prefix = "";

  if (isRuffDeclaredInProject(cwd, pmInfo) && pmInfo.execPrefix) {
    prefix = `${pmInfo.execPrefix} `;
  } else if (checkExec("uvx")) {
    prefix = "uvx ";
  } else if (checkExec("uv")) {
    prefix = "uv tool run ";
  } else if (checkExec("pipx")) {
    prefix = "pipx run ";
  } else if (checkExec("ruff")) {
    prefix = "";
  } else {
    const pyBin = getPythonBinary();
    prefix = `${pyBin} -m `;
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
