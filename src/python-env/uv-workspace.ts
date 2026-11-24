import type { ParsedToml } from "./types";

import { collectParentDirs } from "./directory-utils";
import { readPyprojectToml } from "./toml-parser";
import { isValidUvWorkspaceConfig, isWorkspaceMember, isObject } from "./types";

export function getWorkspaceConfigInDir(
  dir: string,
): { dir: string; toml: ParsedToml; config: Record<string, unknown> } | null {
  const pyproject = readPyprojectToml(dir);
  if (
    pyproject?.success === true &&
    isObject(pyproject.data.tool) &&
    isObject((pyproject.data.tool as Record<string, unknown>).uv) &&
    isValidUvWorkspaceConfig(
      ((pyproject.data.tool as Record<string, unknown>).uv as Record<string, unknown>).workspace,
    )
  ) {
    return {
      dir,
      toml: pyproject,
      config: ((pyproject.data.tool as Record<string, unknown>).uv as Record<string, unknown>)
        .workspace as Record<string, unknown>,
    };
  }
  return null;
}

export function findWorkspaceRoot(
  startDir: string,
): { dir: string; toml: ParsedToml; config: Record<string, unknown> } | null {
  const parentDirs = collectParentDirs(startDir);
  for (const dir of parentDirs) {
    const config = getWorkspaceConfigInDir(dir);
    if (config) {
      return config;
    }
  }
  return null;
}

export function isInUvWorkspace(
  cwd: string,
  projectDir: string,
  workspaceRoot: { dir: string; config: Record<string, unknown> } | null,
): boolean {
  if (!workspaceRoot) return false;
  return isWorkspaceMember(workspaceRoot.dir, projectDir, workspaceRoot.config);
}

export function findWorkspaceRootContext(
  dirs: string[],
  childDir: string,
  startIndex: number = 0,
): { dir?: string; toml?: ParsedToml | null } {
  for (let i = startIndex; i < dirs.length; i++) {
    const parentDir = dirs[i];
    const wsInfo = getWorkspaceConfigInDir(parentDir);
    if (wsInfo && isWorkspaceMember(parentDir, childDir, wsInfo.config)) {
      return { dir: parentDir, toml: wsInfo.toml };
    }
  }
  return {};
}
