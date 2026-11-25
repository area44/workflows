import type { JsPackageManifest, RuntimeSignals } from "./types";

export function isSupportedRuntime(runtime: string): runtime is "node" | "bun" {
  return runtime === "node" || runtime === "bun";
}

export function isSupportedPackageManager(pmName: string): pmName is "npm" | "pnpm" | "bun" {
  return pmName === "npm" || pmName === "pnpm" || pmName === "bun";
}

export function validateRuntimePackageManagerCompatibility(runtime: string, pmName: string): void {
  if (!isSupportedRuntime(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Supported runtimes are: node, bun.`);
  }

  if (!isSupportedPackageManager(pmName)) {
    throw new Error(
      `Unsupported package manager "${pmName}". Supported package managers are: npm, pnpm, bun.`,
    );
  }

  if (runtime === "bun" && pmName === "npm") {
    throw new Error(
      `Unsupported runtime and package manager combination: Bun runtime does not support npm package manager. Bun runtime requires Bun or pnpm package manager.`,
    );
  }
}

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

export function collectRuntimeSignals(
  pm: { name: string },
  project?: import("./types").JsProjectEnvironment,
): RuntimeSignals {
  const pkg = project?.packageJson;
  const hasBunPm = pm.name === "bun";
  const hasBunVersionFile = Boolean(project?.hasBunVersionFile);
  const hasNodeVersionFile = Boolean(project?.hasNodeVersionFile);
  const hasBunDevEngine = hasDevEngineRuntime(pkg, "bun");
  const hasNodeDevEngine = hasDevEngineRuntime(pkg, "node");
  const nodeFileVersionFile = project?.nodeFileVersionFile;

  return {
    hasBunPm,
    hasBunVersionFile,
    hasNodeVersionFile,
    hasBunDevEngine,
    hasNodeDevEngine,
    nodeFileVersionFile,
  };
}

export function validateRuntimeConflicts(signals: RuntimeSignals): void {
  const {
    hasBunPm,
    hasBunVersionFile,
    hasNodeVersionFile,
    hasBunDevEngine,
    hasNodeDevEngine,
    nodeFileVersionFile,
  } = signals;

  if (hasBunDevEngine && hasNodeDevEngine) {
    throw new Error(
      "Conflicting runtime configuration in package.json devEngines: both Node.js and Bun runtimes are specified.",
    );
  }

  if (hasBunPm) {
    if (hasNodeDevEngine) {
      throw new Error(
        "Conflicting runtime configuration: packageManager indicates Bun but package.json devEngines specifies Node.js runtime.",
      );
    }
    if (hasNodeVersionFile) {
      const nodeFile = nodeFileVersionFile || ".nvmrc / .node-version";
      throw new Error(
        `Conflicting runtime configuration: packageManager indicates Bun but Node.js version file (${nodeFile}) specifies Node.js runtime.`,
      );
    }
  }

  if (hasBunVersionFile && hasNodeVersionFile && !hasBunDevEngine && !hasNodeDevEngine) {
    const nodeFile = nodeFileVersionFile || ".nvmrc / .node-version";
    throw new Error(
      `Conflicting runtime version files detected: found both .bun-version and Node.js version file (${nodeFile}).`,
    );
  }

  if (hasBunVersionFile && hasNodeDevEngine) {
    throw new Error(
      "Conflicting runtime configuration: found .bun-version file but package.json devEngines specifies Node.js runtime.",
    );
  }

  if (hasNodeVersionFile && hasBunDevEngine) {
    const nodeFile = nodeFileVersionFile || ".nvmrc / .node-version";
    throw new Error(
      `Conflicting runtime configuration: found Node.js version file (${nodeFile}) but package.json devEngines specifies Bun runtime.`,
    );
  }
}

export function resolveRuntime(
  pm: { name: string },
  project?: import("./types").JsProjectEnvironment,
): "node" | "bun" {
  const hasJsProject = Boolean(
    project?.hasPackageJson ||
    project?.hasPnpmLock ||
    project?.hasPackageLock ||
    project?.hasBunLock,
  );
  if (!hasJsProject) {
    return "node";
  }

  const signals = collectRuntimeSignals(pm, project);
  validateRuntimeConflicts(signals);

  if (signals.hasBunDevEngine) return "bun";
  if (signals.hasNodeDevEngine) return "node";
  if (signals.hasBunVersionFile) return "bun";
  if (signals.hasNodeVersionFile) return "node";
  if (signals.hasBunPm) return "bun";

  return "node";
}
