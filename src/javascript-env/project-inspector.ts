import fs from "node:fs";
import path from "node:path";

import type { JsPackageManifest } from "./types";

function resolveFilePath(filename: string, cwd: string): string {
  if (cwd === process.cwd()) {
    return filename;
  }
  return path.join(cwd, filename);
}

function inspectPackageJson(cwd: string): {
  hasPackageJson: boolean;
  packageJson?: JsPackageManifest;
  packageJsonError?: string;
  packageJsonErrorType?: "read" | "parse";
  packageJsonErrorCause?: unknown;
} {
  const packageJsonPath = resolveFilePath("package.json", cwd);
  const hasPackageJson = fs.existsSync(packageJsonPath);
  if (!hasPackageJson) {
    return { hasPackageJson: false };
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(packageJsonPath, "utf8");
  } catch (readErr) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    return {
      hasPackageJson: true,
      packageJsonError: `Failed to read package.json: ${msg}`,
      packageJsonErrorType: "read",
      packageJsonErrorCause: readErr,
    };
  }

  try {
    const packageJson = JSON.parse(rawContent);
    return { hasPackageJson: true, packageJson };
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return {
      hasPackageJson: true,
      packageJsonError: `Failed to parse package.json: ${msg}`,
      packageJsonErrorType: "parse",
      packageJsonErrorCause: parseErr,
    };
  }
}

function detectLockfiles(cwd: string): {
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
} {
  let hasPnpmLock = false;
  let hasPackageLock = false;
  let hasBunLock = false;

  try {
    hasPnpmLock = fs.existsSync(resolveFilePath("pnpm-lock.yaml", cwd));
    hasPackageLock = fs.existsSync(resolveFilePath("package-lock.json", cwd));
    hasBunLock = fs.existsSync(resolveFilePath("bun.lock", cwd));
  } catch {
    // Ignore detection errors
  }

  return { hasPnpmLock, hasPackageLock, hasBunLock };
}

export function inspectJsProjectEnvironment(
  cwd: string = process.cwd(),
): import("./types").JsProjectEnvironment {
  const pkgInfo = inspectPackageJson(cwd);
  const lockfiles = detectLockfiles(cwd);
  const hasBunVersionFile = fs.existsSync(resolveFilePath(".bun-version", cwd));
  const hasNvmRc = fs.existsSync(resolveFilePath(".nvmrc", cwd));
  const hasNodeVersion = fs.existsSync(resolveFilePath(".node-version", cwd));
  const hasNodeVersionFile = hasNvmRc || hasNodeVersion;
  const nodeFileVersionFile = hasNvmRc ? ".nvmrc" : hasNodeVersion ? ".node-version" : undefined;

  return {
    hasPackageJson: pkgInfo.hasPackageJson,
    packageJson: pkgInfo.packageJson,
    packageJsonError: pkgInfo.packageJsonError,
    packageJsonErrorType: pkgInfo.packageJsonErrorType,
    packageJsonErrorCause: pkgInfo.packageJsonErrorCause,
    hasBunVersionFile,
    hasNodeVersionFile,
    nodeFileVersionFile,
    hasPnpmLock: lockfiles.hasPnpmLock,
    hasPackageLock: lockfiles.hasPackageLock,
    hasBunLock: lockfiles.hasBunLock,
  };
}

export { resolveFilePath };
