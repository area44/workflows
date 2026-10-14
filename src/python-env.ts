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

export interface PythonPackageManagerInfo {
  name: PythonPackageManager;
  lockfile?: string;
  configFile?: string;
  installCommand: string;
  execPrefix: string;
}

export type RuffExecutionMode = "check" | "format-check" | "format" | "autofix";

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
    const reqPath = path.join(cwd, "requirements.txt");
    let reqContent = "";
    try {
      reqContent = fs.readFileSync(reqPath, "utf8");
    } catch {
      // Ignore read error
    }
    const hasRuffInReqs = /^\s*ruff\b/im.test(reqContent);
    installCommand = hasRuffInReqs
      ? "pip install -r requirements.txt"
      : "pip install -r requirements.txt && pip install ruff";
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
  let pyprojectContent: string | undefined;
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    try {
      pyprojectContent = fs.readFileSync(pyprojectPath, "utf8");
    } catch {
      // Ignore read errors
    }
  }

  return (
    detectUv(cwd, pyprojectContent) ||
    detectPoetry(cwd, pyprojectContent) ||
    detectPdm(cwd, pyprojectContent) ||
    detectPipenv(cwd) ||
    detectPip(cwd, pyprojectContent)
  );
}

export function getPythonRuffCommands(
  pmInfo: PythonPackageManagerInfo,
  mode: RuffExecutionMode = "autofix",
): string[] {
  const prefix = pmInfo.execPrefix ? `${pmInfo.execPrefix} ` : "";

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
