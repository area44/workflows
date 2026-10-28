import type { ResolvedJsEnvironment } from "./javascript-env.js";
import type { ResolvedEnvironment } from "./resolve-environment.js";

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
  js: Pick<ResolvedJsEnvironment, "bunVersion" | "nodeVersion">,
): string {
  if (js.bunVersion) {
    return `bun@${js.bunVersion}`;
  }
  if (js.nodeVersion && !js.nodeVersion.startsWith("lts")) {
    return `node@${js.nodeVersion}`;
  }
  return "node@lts";
}

/**
 * Derives setup parameters for actions/setup-node from a resolved environment.
 */
export function setupNode(env: ResolvedEnvironment): NodeSetupConfig {
  const js = env.js;
  const shouldSetup = Boolean(js.nodeVersion);
  return {
    shouldSetup,
    nodeVersion: js.nodeVersion,
    cache: js.pm.name === "npm" ? "npm" : "",
  };
}

/**
 * Derives setup parameters for oven-sh/setup-bun from a resolved environment.
 */
export function setupBun(env: ResolvedEnvironment): BunSetupConfig {
  const js = env.js;
  const shouldSetup = js.pm.name !== "pnpm" && Boolean(js.bunVersion);
  return {
    shouldSetup,
    bunVersion: js.bunVersion,
  };
}

/**
 * Derives setup parameters for package manager setup from a resolved environment.
 */
export function setupPackageManager(env: ResolvedEnvironment): PackageManagerSetupConfig {
  const js = env.js;
  return {
    name: js.pm.name,
    version: js.pm.version,
    pnpmRuntime: resolvePnpmSetupRuntime(js),
    shouldSetupPnpm: js.pm.name === "pnpm",
  };
}
