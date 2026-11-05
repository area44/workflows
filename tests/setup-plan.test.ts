import fs from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ResolvedEnvironment } from "../src/resolve-environment.js";
import {
  createSetupPlan,
  planBunSetup,
  planNodeSetup,
  planPnpmSetup,
} from "../src/setup-plan.js";

describe("setup-plan", () => {
  function createSampleEnvironment(
    overrides?: Partial<ResolvedEnvironment>,
  ): ResolvedEnvironment {
    return {
      javascript: {
        detected: true,
        runtime: { name: "node" },
        packageManager: { name: "npm" },
        toolchain: "vite-plus",
        ...overrides?.javascript,
      },
      python: {
        detected: true,
        packageManager: {
          name: "uv",
          execPrefix: "uv run",
          lockfile: "uv.lock",
          configFile: "pyproject.toml",
          installCommands: [{ executable: "uv", args: ["sync"] }],
          isStandalone: false,
        },
        ...overrides?.python,
      },
    };
  }

  describe("planNodeSetup", () => {
    it("should enable setup and npm cache for Node.js with npm", () => {
      const env = createSampleEnvironment();
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: true,
        cache: "npm",
      });
    });

    it("should enable setup without cache for Node.js with bun package manager", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "bun" },
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: true,
        cache: "",
      });
    });

    it("should disable node setup when package manager is pnpm", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: false,
        cache: "",
      });
    });

    it("should disable node setup when runtime is bun", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun" },
          packageManager: { name: "bun" },
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: false,
        cache: "",
      });
    });
  });

  describe("planBunSetup", () => {
    it("should enable bun setup when runtime is bun and package manager is bun", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun" },
          packageManager: { name: "bun" },
        },
      });
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: true,
      });
    });

    it("should disable bun setup when package manager is pnpm", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun" },
          packageManager: { name: "pnpm" },
        },
      });
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: false,
      });
    });

    it("should disable bun setup when runtime is node", () => {
      const env = createSampleEnvironment();
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: false,
      });
    });
  });

  describe("planPnpmSetup", () => {
    it("should extract pnpm setup options for Node.js runtime", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
        },
      });
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: true,
      });
    });

    it("should extract pnpm setup options for Bun runtime", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun" },
          packageManager: { name: "pnpm" },
        },
      });
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: true,
      });
    });

    it("should disable pnpm setup when package manager is npm", () => {
      const env = createSampleEnvironment();
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: false,
      });
    });
  });

  describe("createSetupPlan", () => {
    it("should generate complete SetupPlan for dual JS and Python project", () => {
      const env = createSampleEnvironment();
      const plan = createSetupPlan(env);

      expect(plan).toEqual({
        node: {
          shouldSetup: true,
          cache: "npm",
        },
        bun: {
          shouldSetup: false,
        },
        pnpm: {
          shouldSetup: false,
        },
      });
    });

    it("should plan setup correctly when Bun runtime is selected with Vite+ toolchain", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun" },
          packageManager: { name: "bun" },
          toolchain: "vite-plus",
        },
      });
      const plan = createSetupPlan(env);

      expect(plan.bun).toEqual({
        shouldSetup: true,
      });
      expect(plan.node).toEqual({
        shouldSetup: false,
        cache: "",
      });
      expect(plan.pnpm.shouldSetup).toBe(false);
    });

    it("should generate complete SetupPlan when neither ecosystem is detected", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: false,
          runtime: { name: "node" },
          packageManager: { name: "npm" },
        },
        python: {
          detected: false,
          packageManager: null,
        },
      });
      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(false);
      expect(plan.bun.shouldSetup).toBe(false);
      expect(plan.pnpm.shouldSetup).toBe(false);
    });
  });

  describe("Boundary Separation (Pure Function Verification)", () => {
    it("createSetupPlan is pure, deterministic, and performs no filesystem access", () => {
      const existsSpy = vi.spyOn(fs, "existsSync");
      const readSpy = vi.spyOn(fs, "readFileSync");

      const env = createSampleEnvironment();
      const plan1 = createSetupPlan(env);
      const plan2 = createSetupPlan(env);

      expect(plan1).toEqual(plan2);
      expect(existsSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    });
  });
});
