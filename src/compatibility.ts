export type SupportedRuntime = "node" | "bun";
export type SupportedPackageManager = "npm" | "pnpm" | "bun";

export interface CompatibilityStatus {
  supported: boolean;
  isDefault?: boolean;
  reason?: string;
}

export interface RuntimePackageManagerCompatibility {
  runtime: string;
  packageManager: string;
  status: CompatibilityStatus;
}

export interface MatrixCombinationEntry {
  runtime: SupportedRuntime;
  packageManager: SupportedPackageManager;
  supported: boolean;
  isDefault?: boolean;
  reason?: string;
}

export interface CanonicalCompatibilityModel {
  runtimes: readonly SupportedRuntime[];
  packageManagers: readonly SupportedPackageManager[];
  combinations: readonly MatrixCombinationEntry[];
}

/**
 * Single canonical source of truth for runtime and package manager compatibility.
 */
export const CANONICAL_COMPATIBILITY_MODEL: CanonicalCompatibilityModel = {
  runtimes: ["node", "bun"] as const,
  packageManagers: ["npm", "pnpm", "bun"] as const,
  combinations: [
    { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
    { runtime: "node", packageManager: "pnpm", supported: true, isDefault: false },
    { runtime: "node", packageManager: "bun", supported: true, isDefault: false },
    { runtime: "bun", packageManager: "pnpm", supported: true, isDefault: false },
    { runtime: "bun", packageManager: "bun", supported: true, isDefault: false },
    {
      runtime: "bun",
      packageManager: "npm",
      supported: false,
      reason:
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager. Bun runtime requires Bun or pnpm package manager.",
    },
  ] as const,
};

export const SUPPORTED_RUNTIMES: readonly SupportedRuntime[] =
  CANONICAL_COMPATIBILITY_MODEL.runtimes;

export const SUPPORTED_PACKAGE_MANAGERS: readonly SupportedPackageManager[] =
  CANONICAL_COMPATIBILITY_MODEL.packageManagers;

export function isSupportedRuntime(runtime: string): runtime is SupportedRuntime {
  return (CANONICAL_COMPATIBILITY_MODEL.runtimes as readonly string[]).includes(runtime);
}

export function isSupportedPackageManager(pmName: string): pmName is SupportedPackageManager {
  return (CANONICAL_COMPATIBILITY_MODEL.packageManagers as readonly string[]).includes(pmName);
}

/**
 * Evaluates whether a given runtime and package manager combination is supported according to the canonical compatibility model.
 */
export function getCombinationCompatibility(
  runtime: string,
  pmName: string,
): RuntimePackageManagerCompatibility {
  if (!isSupportedRuntime(runtime)) {
    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason: `Unsupported runtime "${runtime}". Supported runtimes are: ${SUPPORTED_RUNTIMES.join(", ")}.`,
      },
    };
  }

  if (!isSupportedPackageManager(pmName)) {
    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason: `Unsupported package manager "${pmName}". Supported package managers are: ${SUPPORTED_PACKAGE_MANAGERS.join(", ")}.`,
      },
    };
  }

  const combination = CANONICAL_COMPATIBILITY_MODEL.combinations.find(
    (c) => c.runtime === runtime && c.packageManager === pmName,
  );

  if (combination) {
    if (combination.supported) {
      return {
        runtime,
        packageManager: pmName,
        status: {
          supported: true,
          isDefault: Boolean(combination.isDefault),
        },
      };
    }

    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason:
          combination.reason ||
          `Unsupported runtime and package manager combination: ${runtime} runtime does not support ${pmName} package manager.`,
      },
    };
  }

  return {
    runtime,
    packageManager: pmName,
    status: {
      supported: false,
      reason: `Unsupported runtime and package manager combination: ${runtime} runtime does not support ${pmName} package manager.`,
    },
  };
}

/**
 * Validates a runtime and package manager combination. Throws an Error if the combination is unsupported or invalid.
 */
export function validateRuntimePackageManagerCompatibility(
  runtime: string,
  pmName: string,
): RuntimePackageManagerCompatibility {
  const compatibility = getCombinationCompatibility(runtime, pmName);
  if (!compatibility.status.supported) {
    throw new Error(compatibility.status.reason);
  }
  return compatibility;
}
