import type { ResolvedEnvironment } from "./resolve-environment";

export interface NodeSetupConfig {
  shouldSetup: boolean;
  nodeVersion: string;
  cache: string;
}

export interface BunSetupConfig {
  shouldSetup: boolean;
  bunVersion: string;
}

export interface PackageManagerSetupConfig {
  name: string;
  version: string;
  pnpmRuntime: string;
  shouldSetupPnpm: boolean;
}

/**
 * Formats the runtime argument for pnpm/setup based on resolved Bun or Node.js versions.
 */
export function resolvePnpmSetupRuntime(
  env: ResolvedEnvironment | { bunVersion: string; nodeVersion: string },
): string {
  if (env.bunVersion) {
    return `bun@${env.bunVersion}`;
  }
  if (env.nodeVersion && !env.nodeVersion.startsWith("lts")) {
    return `node@${env.nodeVersion}`;
  }
  return "node@lts";
}

/**
 * Legacy wrapper alias for resolvePnpmSetupRuntime.
 */
export function getPnpmRuntime(
  bunVersionOrEnv: string | ResolvedEnvironment | { bunVersion: string; nodeVersion: string },
  nodeVersion: string = "",
): string {
  if (typeof bunVersionOrEnv === "string") {
    return resolvePnpmSetupRuntime({ bunVersion: bunVersionOrEnv, nodeVersion });
  }
  return resolvePnpmSetupRuntime(bunVersionOrEnv);
}

/**
 * Derives setup parameters for actions/setup-node from a resolved environment.
 */
export function setupNode(env: ResolvedEnvironment): NodeSetupConfig {
  const shouldSetup = env.pm.name !== "pnpm" && Boolean(env.nodeVersion);
  return {
    shouldSetup,
    nodeVersion: env.nodeVersion,
    cache: env.pm.name === "npm" ? "npm" : "",
  };
}

/**
 * Derives setup parameters for oven-sh/setup-bun from a resolved environment.
 */
export function setupBun(env: ResolvedEnvironment): BunSetupConfig {
  const shouldSetup = env.pm.name !== "pnpm" && Boolean(env.bunVersion);
  return {
    shouldSetup,
    bunVersion: env.bunVersion,
  };
}

/**
 * Derives setup parameters for package manager setup from a resolved environment.
 */
export function setupPackageManager(env: ResolvedEnvironment): PackageManagerSetupConfig {
  return {
    name: env.pm.name,
    version: env.pm.version,
    pnpmRuntime: resolvePnpmSetupRuntime(env),
    shouldSetupPnpm: env.pm.name === "pnpm",
  };
}
