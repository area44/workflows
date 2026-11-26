import fs from "node:fs";
import path from "node:path";

/**
 * Traverses directories from cwd up to the repository root (stopping at .git or filesystem root)
 * to gather Python project configuration, manifests, and lockfiles across parent directories and workspace roots.
 */
export function collectParentDirs(resolvedCwd: string): string[] {
  const dirs: string[] = [];
  let curr = resolvedCwd;

  while (true) {
    dirs.push(curr);
    if (fs.existsSync(path.join(curr, ".git"))) {
      break;
    }
    const parent = path.dirname(curr);
    if (parent === curr) {
      break;
    }
    curr = parent;
  }
  return dirs;
}

export function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || normalized === "") {
    return /^$/;
  }
  let regexStr = "^";
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i++;
      continue;
    }
    if (char === "?") {
      regexStr += "[^/]";
      i++;
      continue;
    }
    if ("./+^$()|[]{}\\".includes(char)) {
      regexStr += "\\" + char;
      i++;
      continue;
    }
    regexStr += char;
    i++;
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

export function isDirectoryMatchedByGlobs(relPath: string, globs: string[]): boolean {
  let normRelPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normRelPath === ".") {
    normRelPath = "";
  }
  for (const glob of globs) {
    if (globToRegex(glob).test(normRelPath)) {
      return true;
    }
  }
  return false;
}
