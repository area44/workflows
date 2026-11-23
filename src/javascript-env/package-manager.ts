import * as core from "@actions/core";
import type { JsPackageManagerInfo, JsProjectEnvironment, SupportedPackageManager } from "@/javascript-env/types";
import { isSupportedPackageManager } from "@/javascript-env/sanitize";

function parseDevEnginePmItem(pm: unknown): JsPackageManagerInfo | undefined {
  if (typeof pm === "string") {
    const trimmed = pm.trim();
    if (!trimmed) return undefined;
    const atIdx = trimmed.indexOf("@");
    const rawName = atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed;
    const name = rawName.trim().toLowerCase();
    if (isSupportedPackageManager(name)) {
      return { name };
    }
  } else if (typeof pm === "object" && pm !== null) {
    const obj = pm as Record<string, unknown>;
    if (typeof obj.name === "string" || typeof obj.name === "number") {
      const nameStr = String(obj.name).trim().toLowerCase();
      if (isSupportedPackageManager(nameStr)) {
        return { name: nameStr };
      }
    }
  }
  return undefined;
}

function getDevEnginePackageManager(pkg: any): JsPackageManagerInfo | undefined {
  if (!pkg.devEngines || typeof pkg.devEngines !== "object") return undefined;

  if (pkg.devEngines.packageManager) {
    const pmList = Array.isArray(pkg.devEngines.packageManager)
      ? pkg.devEngines.packageManager
      : [pkg.devEngines.packageManager];

    for (const pm of pmList) {
      const parsed = parseDevEnginePmItem(pm);
      if (parsed) return parsed;
    }
  }

  return undefined;
}

function resolvePmFromPackageJson(project: JsProjectEnvironment): JsPackageManagerInfo | undefined {
  if (project.packageJsonError) {
    if (project.hasPackageJson) {
      core.warning(`Failed to detect package manager: ${project.packageJsonError}`);
    }
    return undefined;
  }

  if (!project.packageJson) {
    return undefined;
  }

  const pkg = project.packageJson;
  if (pkg.packageManager && typeof pkg.packageManager === "string") {
    const trimmed = pkg.packageManager.trim();
    const atIdx = trimmed.indexOf("@");
    const rawName = (atIdx !== -1 ? trimmed.slice(0, atIdx) : trimmed).trim();
    const name = rawName.toLowerCase();
    if (!isSupportedPackageManager(name)) {
      throw new Error(
        `Unsupported package manager '${rawName}'. Supported package managers are npm, pnpm, and bun.`,
      );
    }
    return { name, source: "packageManager" };
  }

  const devPm = getDevEnginePackageManager(pkg);
  if (devPm) {
    return { ...devPm, source: "devEngines" };
  }

  return undefined;
}

function resolvePmFromLockfiles(project: JsProjectEnvironment): JsPackageManagerInfo | undefined {
  const detectedLocks: Array<{ name: SupportedPackageManager; file: string }> = [];
  if (project.hasPnpmLock) detectedLocks.push({ name: "pnpm", file: "pnpm-lock.yaml" });
  if (project.hasPackageLock) detectedLocks.push({ name: "npm", file: "package-lock.json" });
  if (project.hasBunLock) detectedLocks.push({ name: "bun", file: "bun lockfile" });

  if (detectedLocks.length === 0) {
    return undefined;
  }

  if (detectedLocks.length > 1) {
    const fileList = detectedLocks.map((l) => l.file).join(", ");
    if (project.hasPackageJson) {
      core.warning(
        `Multiple conflicting lockfiles found (${fileList}). Selecting '${detectedLocks[0].file}' (${detectedLocks[0].name}) based on priority precedence.`,
      );
    }
  }

  const selected = detectedLocks[0];
  return { name: selected.name, source: "lockfile" };
}

export function resolveJsPackageManager(project: JsProjectEnvironment): JsPackageManagerInfo {
  const pkgPm = resolvePmFromPackageJson(project);
  if (pkgPm) {
    return pkgPm;
  }

  const lockPm = resolvePmFromLockfiles(project);
  if (lockPm) {
    return lockPm;
  }

  return { name: "npm", source: "default" };
}