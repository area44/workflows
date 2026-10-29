import type { ResolvedEnvironment } from "./resolve-environment.js";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  type ResolvedJavaScriptEnvironment,
} from "./javascript-env.js";

export interface NodeSetupPlan {
  shouldSetup: boolean;
  version: string;
  cache: string;
}

export interface BunSetupPlan {
  shouldSetup: boolean;
  version: string;
}

export interface PnpmSetupPlan {
  shouldSetup: boolean;
  pnpmRuntime: string;
}

export interface SetupPlan {
  node: NodeSetupPlan;
  bun: BunSetupPlan;
  pnpm: PnpmSetupPlan;
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

export function planNodeSetup(js: ResolvedJavaScriptEnvironment): NodeSetupPlan {
  const shouldSetup =
    js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "node";
  return {
    shouldSetup,
    version: js.runtime.name === "node" ? js.runtime.version : DEFAULT_NODE_VERSION,
    cache: js.detected && js.packageManager.name === "npm" ? "npm" : "",
  };
}

export function planBunSetup(js: ResolvedJavaScriptEnvironment): BunSetupPlan {
  const shouldSetup = js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "bun";
  return {
    shouldSetup,
    version: js.runtime.name === "bun" ? js.runtime.version : DEFAULT_BUN_VERSION,
  };
}

export function planPnpmSetup(js: ResolvedJavaScriptEnvironment): PnpmSetupPlan {
  const shouldSetup = js.detected && js.packageManager.name === "pnpm";
  return {
    shouldSetup,
    pnpmRuntime: resolvePnpmSetupRuntime(js),
  };
}

/**
 * Pure, deterministic function that constructs a complete SetupPlan from a ResolvedEnvironment.
 *
 * Requirements:
 * - Has no filesystem access.
 * - Has no GitHub Actions side effects.
 * - Does not perform environment detection.
 * - Does not duplicate logic already owned by environment resolvers.
 */
export function createSetupPlan(env: ResolvedEnvironment): SetupPlan {
  return {
    node: planNodeSetup(env.javascript),
    bun: planBunSetup(env.javascript),
    pnpm: planPnpmSetup(env.javascript),
  };
}
