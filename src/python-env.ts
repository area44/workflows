import fs from "node:fs";
import path from "node:path";

export type PythonPackageManager = "uv" | "poetry" | "pdm" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "poetry",
  "pdm",
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

function hasTomlTable(content: string, tableName: string): boolean {
  const escaped = tableName.replace(/\./g, "\\.");
  const pattern = new RegExp(`^\\s*\\[\\s*tool\\.${escaped}(?:\\.|\\s*\\])`, "m");
  return pattern.test(content);
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

  const hasUvLock = fs.existsSync(path.join(cwd, "uv.lock"));
  const hasUvConfig = pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "uv");
  if (hasUvLock || hasUvConfig) {
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

  const hasPoetryLock = fs.existsSync(path.join(cwd, "poetry.lock"));
  const hasPoetryConfig =
    pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "poetry");
  if (hasPoetryLock || hasPoetryConfig) {
    return {
      name: "poetry",
      lockfile: hasPoetryLock ? "poetry.lock" : undefined,
      configFile: hasPoetryConfig ? "pyproject.toml" : undefined,
      installCommand: "poetry install",
      execPrefix: "poetry run",
    };
  }

  const hasPdmLock = fs.existsSync(path.join(cwd, "pdm.lock"));
  const hasPdmConfig = pyprojectContent !== undefined && hasTomlTable(pyprojectContent, "pdm");
  if (hasPdmLock || hasPdmConfig) {
    return {
      name: "pdm",
      lockfile: hasPdmLock ? "pdm.lock" : undefined,
      configFile: hasPdmConfig ? "pyproject.toml" : undefined,
      installCommand: "pdm install",
      execPrefix: "pdm run",
    };
  }

  const hasPipfileLock = fs.existsSync(path.join(cwd, "Pipfile.lock"));
  const hasPipfile = fs.existsSync(path.join(cwd, "Pipfile"));
  const hasRequirements = fs.existsSync(path.join(cwd, "requirements.txt"));
  const hasSetupPy = fs.existsSync(path.join(cwd, "setup.py"));
  const hasSetupCfg = fs.existsSync(path.join(cwd, "setup.cfg"));
  const hasPyproject = pyprojectContent !== undefined;
  const hasProjectOrBuildSystem =
    pyprojectContent !== undefined &&
    /^\s*\[\s*(?:project|build-system)\s*\]/m.test(pyprojectContent);

  const isPipProject =
    hasPipfileLock || hasPipfile || hasRequirements || hasSetupPy || hasSetupCfg || hasPyproject;

  if (isPipProject) {
    let installCommand = "pip install ruff";
    let lockfile: string | undefined;

    let configFile: string | undefined;
    if (hasPyproject) {
      configFile = "pyproject.toml";
    } else if (hasPipfile) {
      configFile = "Pipfile";
    } else if (hasSetupPy) {
      configFile = "setup.py";
    } else if (hasSetupCfg) {
      configFile = "setup.cfg";
    }

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
    } else if (hasPipfileLock || hasPipfile) {
      installCommand = "pipenv install --dev";
      lockfile = hasPipfileLock ? "Pipfile.lock" : undefined;
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

  return null;
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
