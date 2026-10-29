import type { ResolvedJavaScriptEnvironment } from "./javascript-env.js";
import type { ResolvedEnvironment } from "./resolve-environment.js";

export interface NodeSetupPlan {
  shouldSetup: boolean;
  cache: string;
}

export interface BunSetupPlan {
  shouldSetup: boolean;
}

export interface PnpmSetupPlan {
  shouldSetup: boolean;
}

export interface SetupPlan {
  node: NodeSetupPlan;
  bun: BunSetupPlan;
  pnpm: PnpmSetupPlan;
}

export function planNodeSetup(js: ResolvedJavaScriptEnvironment): NodeSetupPlan {
  const shouldSetup =
    js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "node";
  return {
    shouldSetup,
    cache: js.detected && js.packageManager.name === "npm" ? "npm" : "",
  };
}

export function planBunSetup(js: ResolvedJavaScriptEnvironment): BunSetupPlan {
  const shouldSetup = js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "bun";
  return {
    shouldSetup,
  };
}

export function planPnpmSetup(js: ResolvedJavaScriptEnvironment): PnpmSetupPlan {
  const shouldSetup = js.detected && js.packageManager.name === "pnpm";
  return {
    shouldSetup,
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
