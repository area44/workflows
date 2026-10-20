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
  "__tests__",
  "tests",
] as const;

export interface PythonInstallCommand {
  executable: string;
  args: string[];
}

export interface PythonPackageManagerInfo {
  name: PythonPackageManager;
  lockfile?: string;
  configFile?: string;
  installCommand: string;
  installCommands?: PythonInstallCommand[];
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
  const installCommands: PythonInstallCommand[] = hasUvLock
    ? [{ executable: "uv", args: ["sync"] }]
    : hasReqs
      ? [{ executable: "uv", args: ["pip", "install", "-r", "requirements.txt"] }]
      : [{ executable: "uv", args: ["sync"] }];

  const installCommand = hasUvLock
    ? "uv sync"
    : hasReqs
      ? "uv pip install -r requirements.txt"
      : "uv sync";

  return {
    name: "uv",
    lockfile: hasUvLock ? "uv.lock" : undefined,
    configFile: hasUvConfig ? "pyproject.toml" : undefined,
    installCommand,
    installCommands,
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
  let installCommands: PythonInstallCommand[] = [];
  let lockfile: string | undefined;

  const isPackage = hasSetupPy || hasSetupCfg || hasProjectOrBuildSystem;

  if (hasRequirements && isPackage) {
    installCommand = "pip install -r requirements.txt && pip install -e .";
    installCommands = [
      { executable: "pip", args: ["install", "-r", "requirements.txt"] },
      { executable: "pip", args: ["install", "-e", "."] },
    ];
    lockfile = "requirements.txt";
  } else if (hasRequirements) {
    installCommand = "pip install -r requirements.txt";
    installCommands = [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }];
    lockfile = "requirements.txt";
  } else if (isPackage) {
    installCommand = "pip install -e .";
    installCommands = [{ executable: "pip", args: ["install", "-e", "."] }];
  }

  return {
    name: "pip",
    lockfile,
    configFile,
    installCommand,
    installCommands,
    execPrefix: "",
  };
}

function stripToolRuffSections(content: string): string {
  const lines = content.split("\n");
  const filteredLines: string[] = [];
  let inToolRuff = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[\s*([^\]]+)\s*\]/);
    if (sectionMatch) {
      const header = sectionMatch[1].trim().toLowerCase();
      if (header === "tool.ruff" || header.startsWith("tool.ruff.")) {
        inToolRuff = true;
      } else {
        inToolRuff = false;
      }
    }
    if (!inToolRuff) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join("\n");
}

export function hasPythonProject(cwd: string = process.cwd()): boolean {
  if (hasPythonSource(cwd)) {
    return true;
  }

  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, "utf8");
      const stripped = stripToolRuffSections(content);
      if (/^\s*\[\s*(?:project|build-system|tool\.uv)/m.test(stripped)) {
        return true;
      }
      if (isRuffDeclaredInProject(cwd)) {
        return true;
      }
    } catch {
      // Ignore read error
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

function resolveRuffVersionFromPyproject(cwd: string): string | undefined {
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) return undefined;
  try {
    const rawContent = fs.readFileSync(pyprojectPath, "utf8");
    const strippedContent = stripToolRuffSections(rawContent).replace(/#.*/g, "");

    const arrayMatch = strippedContent.match(/["'](ruff(?:[<>=~^!@].*?|))["']/i);
    if (arrayMatch && arrayMatch[1] && arrayMatch[1].toLowerCase().startsWith("ruff")) {
      const ver = extractRuffVersionSpecifier(arrayMatch[1]);
      if (ver) return ver;
    }

    const keyValMatch = strippedContent.match(/^\s*ruff\s*=\s*["']([^"']+)["']/im);
    if (keyValMatch && keyValMatch[1]) {
      const ver = extractRuffVersionSpecifier(keyValMatch[1]);
      if (ver) return ver;
    }
  } catch {
    // Ignore read error
  }
  return undefined;
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

export function resolveRuffVersion(cwd: string = process.cwd()): string {
  return (
    resolveRuffVersionFromUvLock(cwd) ||
    resolveRuffVersionFromPyproject(cwd) ||
    resolveRuffVersionFromRequirements(cwd) ||
    ""
  );
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
      const stripped = stripToolRuffSections(content).replace(/#.*/g, "");
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
