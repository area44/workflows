import fs from "node:fs";
import path from "node:path";

import type {
  PythonProjectContext,
  PythonPackageManagerInfo,
  ParsedToml,
  PythonInstallCommand,
  ResolvedPythonEnvironment,
} from "./types";

import { hasPythonSource, findPythonProjectContext } from "./project-inspector";
import {
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  isObject,
  isValidUvWorkspaceConfig,
  isWorkspaceMember,
} from "./types";
import { getRelativePath } from "./utils";
import { getWorkspaceConfigInDir } from "./uv-workspace";

function isUvProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (hasProjectTable(parsed, rawContent) || hasBuildSystemTable(parsed, rawContent)) {
    return true;
  }
  if (isObject(parsed.tool) && isObject(parsed.tool.uv)) {
    const uv = parsed.tool.uv as Record<string, unknown>;
    return isValidUvWorkspaceConfig(uv.workspace) || Array.isArray(uv["dev-dependencies"]);
  }
  return false;
}

function isUvToolConfigPresent(parsed: Record<string, unknown>): boolean {
  return isObject(parsed.tool) && isObject((parsed.tool as Record<string, unknown>).uv);
}

function isPipProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  return hasProjectTable(parsed, rawContent) || hasBuildSystemTable(parsed, rawContent);
}

function hasProjectTable(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (!isObject(parsed.project)) return false;

  if (typeof rawContent === "string") {
    const stripped = stripTomlStringsAndComments(rawContent);
    return /(?:^|\n)\s*\[\s*project\s*\]\s*(?:\n|$)/.test(stripped);
  }

  const entries = Object.entries(parsed.project);
  if (entries.length === 0) return true;
  return entries.some(([, val]) => !isObject(val));
}

function hasBuildSystemTable(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (!isObject(parsed["build-system"])) return false;

  if (typeof rawContent === "string") {
    const stripped = stripTomlStringsAndComments(rawContent);
    return /(?:^|\n)\s*\[\s*build-system\s*\]\s*(?:\n|$)/.test(stripped);
  }

  const entries = Object.entries(parsed["build-system"]);
  if (entries.length === 0) return true;
  return entries.some(([, val]) => !isObject(val));
}

import { stripTomlStringsAndComments } from "./toml-stripper";

function checkUvLockedProject(
  ctx: PythonProjectContext,
  hasValidPyproject: boolean,
): PythonPackageManagerInfo {
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

function checkUvUnlockedProject(
  ctx: PythonProjectContext,
  hasValidPyproject: boolean,
): PythonPackageManagerInfo | null {
  if (ctx.hasRequirementsTxt && ctx.requirementsDir) {
    const reqPathRel = getRelativePath(ctx.cwd, path.join(ctx.requirementsDir, "requirements.txt"));
    return {
      name: "uv",
      configFile: ctx.pyprojectDir ? "pyproject.toml" : "uv.toml",
      installCommands: [{ executable: "uv", args: ["pip", "install", "-r", reqPathRel] }],
      execPrefix: "uv run",
    };
  }

  if (hasValidPyproject) {
    return {
      name: "uv",
      configFile: ctx.pyprojectDir ? "pyproject.toml" : "uv.toml",
      installCommands: [{ executable: "uv", args: ["sync"] }],
      lockCommand: "uv lock",
      syncCommand: "uv sync",
      execPrefix: "uv run",
    };
  }

  return null;
}

function detectUvFromContext(ctx: PythonProjectContext): PythonPackageManagerInfo | null {
  const localPyprojectValid =
    ctx.pyprojectToml?.success === true &&
    isUvProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent);

  const workspacePyprojectValid =
    ctx.workspaceRootToml?.success === true &&
    isUvProjectConfigPresent(ctx.workspaceRootToml.data, ctx.workspaceRootToml.rawContent);

  const hasValidPyproject = localPyprojectValid || workspacePyprojectValid;

  const hasUvToml = ctx.uvToml?.success === true;
  const hasUvToolConfig =
    (ctx.pyprojectToml?.success === true && isUvToolConfigPresent(ctx.pyprojectToml.data)) ||
    (ctx.workspaceRootToml?.success === true && isUvToolConfigPresent(ctx.workspaceRootToml.data));

  if (ctx.hasUvLock) {
    return checkUvLockedProject(ctx, hasValidPyproject);
  }

  if (hasUvToolConfig || hasUvToml) {
    return checkUvUnlockedProject(ctx, hasValidPyproject);
  }

  return null;
}

function detectPipFromContext(ctx: PythonProjectContext): PythonPackageManagerInfo | null {
  const hasProjectOrBuildSystem =
    ctx.pyprojectToml?.success === true &&
    isPipProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent);

  const isPipProject =
    ctx.hasRequirementsTxt || ctx.hasSetupPy || ctx.hasSetupCfg || hasProjectOrBuildSystem;
  if (!isPipProject) return null;

  let configFile: string | undefined;
  if (hasProjectOrBuildSystem) {
    configFile = "pyproject.toml";
  } else if (ctx.hasSetupPy) {
    configFile = "setup.py";
  } else if (ctx.hasSetupCfg) {
    configFile = "setup.cfg";
  }

  let installCommands: PythonInstallCommand[] = [];
  let lockfile: string | undefined;

  const isPackage = ctx.hasSetupPy || ctx.hasSetupCfg || hasProjectOrBuildSystem;

  const reqPathRel = ctx.requirementsDir
    ? getRelativePath(ctx.cwd, path.join(ctx.requirementsDir, "requirements.txt"))
    : "requirements.txt";

  const projectDirRel = getRelativePath(ctx.cwd, ctx.projectDir);

  if (ctx.hasRequirementsTxt && isPackage) {
    installCommands = [
      { executable: "pip", args: ["install", "-r", reqPathRel] },
      { executable: "pip", args: ["install", "-e", projectDirRel] },
    ];
    lockfile = "requirements.txt";
  } else if (ctx.hasRequirementsTxt) {
    installCommands = [{ executable: "pip", args: ["install", "-r", reqPathRel] }];
    lockfile = "requirements.txt";
  } else if (isPackage) {
    installCommands = [{ executable: "pip", args: ["install", "-e", projectDirRel] }];
  }

  return {
    name: "pip",
    lockfile,
    configFile,
    installCommands,
    execPrefix: "",
  };
}

export function detectPythonPackageManagerFromContext(
  ctx: PythonProjectContext,
  pyprojectToml?: ParsedToml | null,
): PythonPackageManagerInfo {
  if (pyprojectToml !== undefined && pyprojectToml !== null) {
    ctx.pyprojectToml = pyprojectToml;
  }

  for (const pm of PYTHON_PACKAGE_MANAGER_PRIORITY) {
    if (pm === "uv") {
      const uvInfo = detectUvFromContext(ctx);
      if (uvInfo) return uvInfo;
    } else if (pm === "pip") {
      const pipInfo = detectPipFromContext(ctx);
      if (pipInfo) return pipInfo;
    }
  }

  // Standalone Python project without manifest or lockfile
  return {
    name: "pip",
    installCommands: [],
    execPrefix: "",
    isStandalone: true,
  };
}

function hasOwnManifestFiles(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "pyproject.toml")) ||
    fs.existsSync(path.join(dir, "requirements.txt")) ||
    fs.existsSync(path.join(dir, "setup.py")) ||
    fs.existsSync(path.join(dir, "setup.cfg")) ||
    fs.existsSync(path.join(dir, "uv.lock"))
  );
}

export function hasPythonProject(
  cwd: string = process.cwd(),
  precomputed?: { ctx?: PythonProjectContext; hasSource?: boolean },
): boolean {
  const hasSource = precomputed?.hasSource ?? hasPythonSource(cwd);
  if (hasSource) {
    return true;
  }

  const ctx = precomputed?.ctx ?? findPythonProjectContext(cwd);

  const isSelf = ctx.projectDir === ctx.cwd && hasOwnManifestFiles(ctx.cwd);
  if (isSelf) {
    if (ctx.pyprojectToml?.success === true) {
      if (isUvProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent)) {
        return true;
      }
    }
    if (ctx.hasUvLock || ctx.hasRequirementsTxt || ctx.hasSetupPy || ctx.hasSetupCfg) {
      return true;
    }
  }

  if (ctx.workspaceRootDir && ctx.workspaceRootToml?.success === true) {
    const wsConfig = getWorkspaceConfigInDir(ctx.workspaceRootDir);
    if (wsConfig && isWorkspaceMember(ctx.workspaceRootDir, path.resolve(cwd), wsConfig.config)) {
      return true;
    }
  }

  return false;
}

export function detectPythonPackageManager(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
  precomputed?: { ctx?: PythonProjectContext; hasSource?: boolean; isProject?: boolean },
): PythonPackageManagerInfo | null {
  const ctx = precomputed?.ctx ?? findPythonProjectContext(cwd);
  const isProject =
    precomputed?.isProject ?? hasPythonProject(cwd, { ctx, hasSource: precomputed?.hasSource });

  if (!isProject) {
    return null;
  }

  return detectPythonPackageManagerFromContext(ctx, pyprojectToml);
}

export function validateInstallCommands(commands: unknown): void {
  if (!Array.isArray(commands)) {
    throw new Error('Invalid Python environment: "pmInfo.installCommands" must be an array');
  }
  for (const cmd of commands) {
    if (!cmd || typeof cmd !== "object") {
      throw new Error('Invalid Python environment: malformed "installCommands" item');
    }
    const item = cmd as Record<string, unknown>;
    if (
      typeof item.executable !== "string" ||
      !item.executable.trim() ||
      !Array.isArray(item.args) ||
      !item.args.every((a: unknown) => typeof a === "string")
    ) {
      throw new Error('Invalid Python environment: malformed "installCommands" item');
    }
  }
}

export function validatePythonPmInfoStructure(
  pmInfo: unknown,
  errorMessageWhenNonObject: string = 'Invalid Python environment: "pmInfo" must be an object',
): Record<string, unknown> {
  if (!pmInfo || typeof pmInfo !== "object" || Array.isArray(pmInfo)) {
    throw new Error(errorMessageWhenNonObject);
  }
  const obj = pmInfo as Record<string, unknown>;
  if (obj.name !== "uv" && obj.name !== "pip") {
    throw new Error(`Invalid Python environment: pmInfo name must be "uv" or "pip"`);
  }
  validateInstallCommands(obj.installCommands);
  return obj;
}

export function resolvePythonEnvironment(cwd: string = process.cwd()): ResolvedPythonEnvironment {
  const hasSource = hasPythonSource(cwd);
  const ctx = findPythonProjectContext(cwd);
  const isPyProject = hasPythonProject(cwd, { ctx, hasSource });

  if (!isPyProject) {
    return {
      detected: false,
      packageManager: null,
    };
  }

  const pmInfo = detectPythonPackageManager(cwd, ctx.pyprojectToml, {
    ctx,
    hasSource,
    isProject: true,
  });

  return {
    detected: true,
    packageManager: pmInfo,
  };
}
