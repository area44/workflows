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

export const SUPPORTED_RUNTIMES: readonly SupportedRuntime[] = ["node", "bun"];
export const SUPPORTED_PACKAGE_MANAGERS: readonly SupportedPackageManager[] = [
  "npm",
  "pnpm",
  "bun",
];

export function isSupportedRuntime(runtime: string): runtime is SupportedRuntime {
  return (SUPPORTED_RUNTIMES as readonly string[]).includes(runtime);
}

export function isSupportedPackageManager(pmName: string): pmName is SupportedPackageManager {
  return (SUPPORTED_PACKAGE_MANAGERS as readonly string[]).includes(pmName);
}

/**
 * Evaluates whether a given runtime and package manager combination is supported according to the repository's contract.
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

  // Bun runtime with npm package manager is explicitly unsupported
  if (runtime === "bun" && pmName === "npm") {
    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason:
          "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager. Bun runtime requires Bun or pnpm package manager.",
      },
    };
  }

  const isDefault = runtime === "node" && pmName === "npm";

  return {
    runtime,
    packageManager: pmName,
    status: {
      supported: true,
      isDefault,
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
