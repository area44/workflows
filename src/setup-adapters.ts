import type { ResolvedJavaScriptEnvironment } from "./javascript-env.js";
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
export function resolvePnpmSetupRuntime(js: ResolvedJavaScriptEnvironment): string {
  if (js.runtime.name === "bun") {
    return `bun@${js.runtime.version}`;
  }
  if (js.runtime.name === "node" && js.runtime.version && !js.runtime.version.startsWith("lts")) {
    return `node@${js.runtime.version}`;
  }
  return "node@lts";
}

/**
 * Derives setup parameters for actions/setup-node from a resolved environment.
 */
export function setupNode(env: ResolvedEnvironment): NodeSetupConfig {
  const js = env.javascript;
  const shouldSetup =
    js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "node";
  return {
    shouldSetup,
    nodeVersion: js.runtime.name === "node" ? js.runtime.version : "",
    cache: js.packageManager.name === "npm" ? "npm" : "",
  };
}

/**
 * Derives setup parameters for oven-sh/setup-bun from a resolved environment.
 */
export function setupBun(env: ResolvedEnvironment): BunSetupConfig {
  const js = env.javascript;
  const shouldSetup = js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "bun";
  return {
    shouldSetup,
    bunVersion: js.runtime.name === "bun" ? js.runtime.version : "",
  };
}

/**
 * Derives setup parameters for package manager setup from a resolved environment.
 */
export function setupPackageManager(env: ResolvedEnvironment): PackageManagerSetupConfig {
  const js = env.javascript;
  const shouldSetupPnpm = js.detected && js.packageManager.name === "pnpm";
  return {
    name: js.packageManager.name,
    version: js.packageManager.version,
    pnpmRuntime: resolvePnpmSetupRuntime(js),
    shouldSetupPnpm,
  };
}
