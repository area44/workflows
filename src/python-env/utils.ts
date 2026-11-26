import fs from "node:fs";
import path from "node:path";

import { findWorkspaceRootContext } from "./uv-workspace";

export function getRelativePath(fromDir: string, toPath: string): string {
  const rel = path.relative(fromDir, toPath);
  if (!rel) return ".";
  return rel;
}

export function findFirstExistingPath(dirs: string[], filename: string): string | undefined {
  for (const dir of dirs) {
    const target = path.join(dir, filename);
    if (fs.existsSync(target)) {
      return target;
    }
  }
  return undefined;
}

export function resolveUvLockDir(
  dirs: string[],
  childDir: string,
  pyprojectDir?: string,
): string | undefined {
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, "uv.lock"))) {
      if (dir === childDir || (pyprojectDir && dir === pyprojectDir)) {
        return dir;
      }
      const ws = findWorkspaceRootContext(dirs, childDir);
      if (ws.dir === dir) {
        return dir;
      }
    }
  }
  return undefined;
}
