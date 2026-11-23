import type { JsPackageManifest } from "@/javascript-env/types";

export function hasDevEngineRuntime(
  pkg: JsPackageManifest | undefined,
  runtimeName: "node" | "bun",
): boolean {
  if (!pkg?.devEngines || typeof pkg.devEngines !== "object") return false;

  const devEngines = pkg.devEngines;

  if (devEngines[runtimeName] !== undefined && devEngines[runtimeName] !== null) {
    return true;
  }

  if (devEngines.runtime) {
    const runtimes = Array.isArray(devEngines.runtime) ? devEngines.runtime : [devEngines.runtime];

    for (const r of runtimes) {
      if (typeof r === "string") {
        const lower = r.trim().toLowerCase();
        if (
          lower === runtimeName ||
          lower.startsWith(`${runtimeName}@`) ||
          lower.startsWith(`${runtimeName}:`) ||
          lower.startsWith(`${runtimeName} `)
        ) {
          return true;
        }
      } else if (typeof r === "object" && r !== null) {
        const objName = (r as Record<string, unknown>).name;
        if (typeof objName === "string" && objName.trim().toLowerCase() === runtimeName) {
          return true;
        }
      }
    }
  }

  return false;
}