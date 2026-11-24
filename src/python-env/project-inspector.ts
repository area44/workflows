import fs from "node:fs";
import path from "node:path";

import type { PythonProjectContext, ParsedToml } from "./types";

import { collectParentDirs } from "./directory-utils";
import { parseTomlFile } from "./toml-parser";
import { DEFAULT_EXCLUDED_DIRS } from "./types";
import { findFirstExistingPath, resolveUvLockDir } from "./utils";
import { findWorkspaceRootContext } from "./uv-workspace";

function hasOwnManifestFiles(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "pyproject.toml")) ||
    fs.existsSync(path.join(dir, "requirements.txt")) ||
    fs.existsSync(path.join(dir, "setup.py")) ||
    fs.existsSync(path.join(dir, "setup.cfg")) ||
    fs.existsSync(path.join(dir, "uv.lock"))
  );
}

function readPyprojectToml(dir: string): ParsedToml | null {
  return parseTomlFile(path.join(dir, "pyproject.toml"));
}

function findSelfManifestContext(resolvedCwd: string, dirs: string[]): PythonProjectContext | null {
  if (!hasOwnManifestFiles(resolvedCwd)) {
    return null;
  }

  const pyprojectToml = readPyprojectToml(resolvedCwd);
  const pyprojectDir = pyprojectToml ? resolvedCwd : undefined;
  const ws = findWorkspaceRootContext(dirs, resolvedCwd, 1);

  const allowedDirs = ws.dir ? dirs.slice(0, dirs.indexOf(ws.dir) + 1) : [resolvedCwd];

  const uvTomlPath = findFirstExistingPath(allowedDirs, "uv.toml");
  const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;
  const uvLockDir = resolveUvLockDir(dirs, resolvedCwd, pyprojectDir);

  const hasRequirementsTxt = fs.existsSync(path.join(resolvedCwd, "requirements.txt"));
  const hasSetupPy = fs.existsSync(path.join(resolvedCwd, "setup.py"));
  const hasSetupCfg = fs.existsSync(path.join(resolvedCwd, "setup.cfg"));

  return {
    cwd: resolvedCwd,
    projectDir: resolvedCwd,
    pyprojectToml,
    pyprojectDir,
    workspaceRootToml: ws.toml,
    workspaceRootDir: ws.dir,
    uvToml,
    uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
    hasUvLock: Boolean(uvLockDir),
    uvLockDir,
    hasRequirementsTxt,
    requirementsDir: hasRequirementsTxt ? resolvedCwd : undefined,
    hasSetupPy,
    setupPyDir: hasSetupPy ? resolvedCwd : undefined,
    hasSetupCfg,
    setupCfgDir: hasSetupCfg ? resolvedCwd : undefined,
  };
}

function findAncestorManifestContext(resolvedCwd: string, dirs: string[]): PythonProjectContext {
  for (let i = 1; i < dirs.length; i++) {
    const pDir = dirs[i];
    if (hasOwnManifestFiles(pDir)) {
      const pyprojectToml = readPyprojectToml(pDir);
      const pyprojectDir = pyprojectToml ? pDir : undefined;
      const ws = findWorkspaceRootContext(dirs, pDir, i + 1);

      const allowedDirs = ws.dir ? dirs.slice(0, dirs.indexOf(ws.dir) + 1) : dirs.slice(0, i + 1);

      const uvTomlPath = findFirstExistingPath(allowedDirs, "uv.toml");
      const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;
      const uvLockDir = resolveUvLockDir(dirs.slice(i), pDir, pyprojectDir);
      const hasRequirementsTxt = fs.existsSync(path.join(pDir, "requirements.txt"));
      const hasSetupPy = fs.existsSync(path.join(pDir, "setup.py"));
      const hasSetupCfg = fs.existsSync(path.join(pDir, "setup.cfg"));

      return {
        cwd: resolvedCwd,
        projectDir: pDir,
        pyprojectToml,
        pyprojectDir,
        workspaceRootToml: ws.toml,
        workspaceRootDir: ws.dir,
        uvToml,
        uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
        hasUvLock: Boolean(uvLockDir),
        uvLockDir,
        hasRequirementsTxt,
        requirementsDir: hasRequirementsTxt ? pDir : undefined,
        hasSetupPy,
        setupPyDir: hasSetupPy ? pDir : undefined,
        hasSetupCfg,
        setupCfgDir: hasSetupCfg ? pDir : undefined,
      };
    }
  }

  const uvTomlPath = findFirstExistingPath(dirs, "uv.toml");
  const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;
  const ws = findWorkspaceRootContext(dirs, resolvedCwd, 0);
  const uvLockDir = resolveUvLockDir(dirs, resolvedCwd, undefined);

  return {
    cwd: resolvedCwd,
    projectDir: resolvedCwd,
    pyprojectToml: null,
    pyprojectDir: undefined,
    workspaceRootToml: ws.toml,
    workspaceRootDir: ws.dir,
    uvToml,
    uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
    hasUvLock: Boolean(uvLockDir),
    uvLockDir,
    hasRequirementsTxt: false,
    requirementsDir: undefined,
    hasSetupPy: false,
    setupPyDir: undefined,
    hasSetupCfg: false,
    setupCfgDir: undefined,
  };
}

export function inspectPythonProject(cwd: string = process.cwd()): PythonProjectContext {
  const resolvedCwd = path.resolve(cwd);
  const parentDirs = collectParentDirs(resolvedCwd);

  const selfCtx = findSelfManifestContext(resolvedCwd, parentDirs);
  if (selfCtx) {
    return selfCtx;
  }
  return findAncestorManifestContext(resolvedCwd, parentDirs);
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

export function findPythonProjectContext(cwd: string = process.cwd()): PythonProjectContext {
  return inspectPythonProject(cwd);
}
