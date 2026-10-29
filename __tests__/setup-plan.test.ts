import fs from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
} from "../src/javascript-env.js";
import type { ResolvedEnvironment } from "../src/resolve-environment.js";
import {
  createSetupPlan,
  planBunSetup,
  planNodeSetup,
  planPnpmSetup,
  planPythonSetup,
  planRuffSetup,
  resolvePnpmSetupRuntime,
} from "../src/setup-plan.js";

describe("setup-plan", () => {
  function createSampleEnvironment(
    overrides?: Partial<ResolvedEnvironment>,
  ): ResolvedEnvironment {
    return {
      javascript: {
        detected: true,
        runtime: { name: "node", version: "24" },
        packageManager: { name: "npm", version: "12" },
        toolchain: "vite",
        ...overrides?.javascript,
      },
      python: {
        detected: true,
        version: "3.12",
        ruffVersion: "0.4.2",
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

  describe("resolvePnpmSetupRuntime", () => {
    it("should format bun runtime specifier when bun runtime is selected", () => {
      expect(
        resolvePnpmSetupRuntime({
          detected: true,
          runtime: { name: "bun", version: "1.4" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        }),
      ).toBe("bun@1.4");
    });

    it("should format node runtime specifier when node runtime is selected and not lts", () => {
      expect(
        resolvePnpmSetupRuntime({
          detected: true,
          runtime: { name: "node", version: "22.1.0" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        }),
      ).toBe("node@22.1.0");
    });

    it("should format node@lts when node version starts with lts or is empty", () => {
      expect(
        resolvePnpmSetupRuntime({
          detected: true,
          runtime: { name: "node", version: "lts/iron" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        }),
      ).toBe("node@lts");

      expect(
        resolvePnpmSetupRuntime({
          detected: true,
          runtime: { name: "node", version: "" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        }),
      ).toBe("node@lts");
    });
  });

  describe("planNodeSetup", () => {
    it("should enable setup and npm cache for Node.js with npm", () => {
      const env = createSampleEnvironment();
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: true,
        version: "24",
        cache: "npm",
      });
    });

    it("should enable setup without cache for Node.js with bun package manager", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node", version: "22" },
          packageManager: { name: "bun", version: "1.4" },
          toolchain: "vite",
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: true,
        version: "22",
        cache: "",
      });
    });

    it("should disable node setup when package manager is pnpm", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: false,
        version: "24",
        cache: "",
      });
    });

    it("should disable node setup when runtime is bun", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun", version: "1.4" },
          packageManager: { name: "bun", version: "1.4" },
          toolchain: "vite",
        },
      });
      expect(planNodeSetup(env.javascript)).toEqual({
        shouldSetup: false,
        version: DEFAULT_NODE_VERSION,
        cache: "",
      });
    });
  });

  describe("planBunSetup", () => {
    it("should enable bun setup when runtime is bun and package manager is bun", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun", version: "1.4" },
          packageManager: { name: "bun", version: "1.4" },
          toolchain: "vite",
        },
      });
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: true,
        version: "1.4",
      });
    });

    it("should disable bun setup when package manager is pnpm", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun", version: "1.4" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        },
      });
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: false,
        version: "1.4",
      });
    });

    it("should disable bun setup when runtime is node", () => {
      const env = createSampleEnvironment();
      expect(planBunSetup(env.javascript)).toEqual({
        shouldSetup: false,
        version: DEFAULT_BUN_VERSION,
      });
    });
  });

  describe("planPnpmSetup", () => {
    it("should extract pnpm setup options for Node.js runtime", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "pnpm", version: "9.0.0" },
          toolchain: "vite",
        },
      });
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: true,
        version: "9.0.0",
        pnpmRuntime: "node@24",
      });
    });

    it("should extract pnpm setup options for Bun runtime", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: true,
          runtime: { name: "bun", version: "1.4" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        },
      });
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: true,
        version: "12",
        pnpmRuntime: "bun@1.4",
      });
    });

    it("should disable pnpm setup when package manager is npm", () => {
      const env = createSampleEnvironment();
      expect(planPnpmSetup(env.javascript)).toEqual({
        shouldSetup: false,
        version: "12",
        pnpmRuntime: "node@24",
      });
    });
  });

  describe("planPythonSetup and planRuffSetup", () => {
    it("should plan python and ruff setup when python project is detected with uv", () => {
      const env = createSampleEnvironment();
      expect(planPythonSetup(env.python)).toEqual({
        shouldSetup: true,
        version: "3.12",
        packageManager: "uv",
      });
      expect(planRuffSetup(env.python)).toEqual({
        shouldSetup: true,
        version: "0.4.2",
      });
    });

    it("should plan python setup for pip package manager", () => {
      const env = createSampleEnvironment({
        python: {
          detected: true,
          version: "3.11",
          ruffVersion: "",
          packageManager: {
            name: "pip",
            execPrefix: "",
            installCommands: [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }],
            isStandalone: false,
          },
        },
      });
      expect(planPythonSetup(env.python)).toEqual({
        shouldSetup: true,
        version: "3.11",
        packageManager: "pip",
      });
      expect(planRuffSetup(env.python)).toEqual({
        shouldSetup: true,
        version: "",
      });
    });

    it("should disable python and ruff setup when python is not detected", () => {
      const env = createSampleEnvironment({
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      });
      expect(planPythonSetup(env.python)).toEqual({
        shouldSetup: false,
        version: "",
        packageManager: "",
      });
      expect(planRuffSetup(env.python)).toEqual({
        shouldSetup: false,
        version: "",
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
          version: "24",
          cache: "npm",
        },
        bun: {
          shouldSetup: false,
          version: DEFAULT_BUN_VERSION,
        },
        pnpm: {
          shouldSetup: false,
          version: "12",
          pnpmRuntime: "node@24",
        },
        python: {
          shouldSetup: true,
          version: "3.12",
          packageManager: "uv",
        },
        ruff: {
          shouldSetup: true,
          version: "0.4.2",
        },
      });
    });

    it("should generate complete SetupPlan for JS-only project", () => {
      const env = createSampleEnvironment({
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      });
      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(true);
      expect(plan.python.shouldSetup).toBe(false);
      expect(plan.ruff.shouldSetup).toBe(false);
    });

    it("should generate complete SetupPlan for Python-only project", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
      });
      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(false);
      expect(plan.bun.shouldSetup).toBe(false);
      expect(plan.pnpm.shouldSetup).toBe(false);
      expect(plan.python.shouldSetup).toBe(true);
      expect(plan.ruff.shouldSetup).toBe(true);
    });

    it("should generate complete SetupPlan when neither ecosystem is detected", () => {
      const env = createSampleEnvironment({
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      });
      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(false);
      expect(plan.bun.shouldSetup).toBe(false);
      expect(plan.pnpm.shouldSetup).toBe(false);
      expect(plan.python.shouldSetup).toBe(false);
      expect(plan.ruff.shouldSetup).toBe(false);
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
