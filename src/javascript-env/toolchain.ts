import type { JsPackageManifest, JsProjectEnvironment } from "@/javascript-env/types";

function isVitePlusKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "vite-plus" ||
    k === "@voidzero-dev/vite-plus" ||
    k === "@voidzero-dev/vite-plus-core" ||
    k.startsWith("@voidzero-dev/vite-plus-")
  );
}

function isVitePlusVal(val: unknown): boolean {
  if (typeof val !== "string") return false;
  const v = val.toLowerCase();
  return v.includes("@voidzero-dev/vite-plus") || v.includes("vite-plus-core");
}

function checkDepSectionForVitePlus(section?: Record<string, string>): boolean {
  if (!section || typeof section !== "object") return false;
  for (const [key, val] of Object.entries(section)) {
    if (typeof key === "string" && (isVitePlusKey(key) || isVitePlusVal(val))) {
      return true;
    }
  }
  return false;
}

function checkCatalogForVitePlus(pkg: any): boolean {
  const catalogObj = pkg.catalog || pkg.catalogs;
  if (!catalogObj || typeof catalogObj !== "object") return false;

  const catalogEntries = Array.isArray(catalogObj) ? catalogObj : Object.values(catalogObj);
  for (const entry of catalogEntries) {
    if (!entry || typeof entry !== "object") continue;
    for (const key of Object.keys(entry as Record<string, unknown>)) {
      if (typeof key === "string" && isVitePlusKey(key)) {
        return true;
      }
    }
  }
  return false;
}

export function hasVitePlusDependency(pkg?: JsPackageManifest): boolean {
  if (!pkg) return false;

  const depSections = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
    pkg.peerDependencies,
  ];

  for (const section of depSections) {
    if (checkDepSectionForVitePlus(section)) {
      return true;
    }
  }

  return checkCatalogForVitePlus(pkg);
}

export function resolveToolchain(
  toolchainInput?: string,
  project?: JsProjectEnvironment,
): "vite-plus" | undefined {
  if (toolchainInput) {
    const trimmed = toolchainInput.trim().toLowerCase();
    if (trimmed && trimmed !== "auto") {
      if (trimmed === "vite-plus") {
        return "vite-plus";
      }
      throw new Error(
        'Invalid toolchain input: unsupported value. Supported values are "auto" or "vite-plus".',
      );
    }
  }

  if (project?.packageJson && hasVitePlusDependency(project.packageJson)) {
    return "vite-plus";
  }

  return undefined;
}
