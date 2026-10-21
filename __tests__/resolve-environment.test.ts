import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getDefaultJsPackageManagerVersion,
} from "../src/javascript-env.js";
import type { ResolvedEnvironment } from "../src/resolve-environment.js";
import {
  resolveEnvironment,
  resolvePnpmSetupRuntime,
  run,
  setupBun,
  setupNode,
  setupPackageManager,
  validateEnvironment,
  writeOutput,
} from "../src/resolve-environment.js";

vi.mock("@actions/core");

describe("resolve-environment", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  const fixturesDir = path.resolve(originalCwd, "__tests__/fixtures");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("runtime constants", () => {
    it("should export default runtime and package manager versions", () => {
      expect(DEFAULT_NODE_VERSION).toBe("24");
      expect(DEFAULT_BUN_VERSION).toBe("1.4");
      expect(DEFAULT_NPM_VERSION).toBe("12");
      expect(DEFAULT_PNPM_VERSION).toBe("12");
      expect(getDefaultJsPackageManagerVersion("npm")).toBe("12");
      expect(getDefaultJsPackageManagerVersion("pnpm")).toBe("12");
      expect(getDefaultJsPackageManagerVersion("bun")).toBe("1.4");
    });
  });

  describe("Cross-Language Integration Scenarios", () => {
    it("should handle JavaScript-only projects correctly", () => {
      const tempDir = path.join(fixturesDir, "js-only-integration-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "js-app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(true);
        expect(env.python.hasPythonSource).toBe(false);
        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle Python-only projects correctly", () => {
      const tempDir = path.join(fixturesDir, "python-only-integration-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'py-app'\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(false);
        expect(env.python.hasPythonSource).toBe(true);
        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle mixed-language (JS + Python) projects correctly", () => {
      const tempDir = path.join(fixturesDir, "mixed-lang-integration-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "mixed-app", packageManager: "pnpm@9.0.0" }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(true);
        expect(env.python.hasPythonSource).toBe(true);
        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "uv");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle projects with neither JS nor Python correctly", () => {
      const tempDir = path.join(fixturesDir, "neither-lang-integration-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Hello\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(false);
        expect(env.python.hasPythonSource).toBe(false);
        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Environment Resolution Pipeline", () => {
    describe("validateEnvironment", () => {
      it("should validate clean env struct", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: false,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
            nodeVersion: "22",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {
            hasPythonSource: false,
            pythonVersion: "",
            ruffVersion: "",
            pmInfo: null,
          },
        };

        const validated = validateEnvironment(env);
        expect(validated.js.runtime).toBe("node");
        expect(validated.js.nodeVersion).toBe("22");
      });

      it("should throw error in validateEnvironment when runtime or package manager is invalid", () => {
        expect(() =>
          validateEnvironment({
            js: {
              hasJsProject: false,
              project: {} as any,
              pm: { name: "npm", version: "12" },
              runtime: "invalid" as any,
              nodeVersion: "24",
              bunVersion: "",
              toolchain: "vite",
            },
            python: {} as any,
          }),
        ).toThrow("Invalid resolved runtime");

        expect(() =>
          validateEnvironment({
            js: {
              hasJsProject: false,
              project: {} as any,
              pm: { name: "", version: "" },
              runtime: "node",
              nodeVersion: "24",
              bunVersion: "",
              toolchain: "vite",
            },
            python: {} as any,
          }),
        ).toThrow("Invalid resolved package manager");
      });
    });

    describe("Pipeline Determinism", () => {
      it("should produce identical resolved environment given identical inputs and project state", () => {
        vi.spyOn(fs, "existsSync").mockImplementation((p) =>
          [".nvmrc", "package-lock.json"].includes(p as string),
        );
        vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
          if (p === ".nvmrc") return "22.1.0\n" as any;
          return "" as any;
        });

        const run1 = resolveEnvironment("node");
        const run2 = resolveEnvironment("node");

        expect(run1).toEqual(run2);
        expect(run1.js.nodeVersion).toBe("22.1.0");
        expect(run1.js.bunVersion).toBe("");
        expect(run1.js.pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
        expect(run1.js.runtime).toBe("node");
        expect(run1.js.toolchain).toBe("vite");
        expect(run1.python.hasPythonSource).toBe(false);
      });
    });
  });

  describe("Tool-Specific Setup Adapters", () => {
    describe("resolvePnpmSetupRuntime", () => {
      it("should format bun runtime specifier when bunVersion is present", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "24",
            bunVersion: "1.4",
          }),
        ).toBe("bun@1.4");
      });

      it("should format node runtime specifier when nodeVersion is present and not lts", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "22.1.0",
            bunVersion: "",
          }),
        ).toBe("node@22.1.0");
      });

      it("should format node@lts when nodeVersion starts with lts or is empty", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "lts/iron",
            bunVersion: "",
          }),
        ).toBe("node@lts");

        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "",
            bunVersion: "",
          }),
        ).toBe("node@lts");
      });
    });

    describe("setupNode adapter", () => {
      it("should return correct setup options for npm package manager", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "24",
          cache: "npm",
        });
      });

      it("should return correct setup options for bun package manager with node runtime", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "node",
            nodeVersion: "22",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "22",
          cache: "",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: false,
          nodeVersion: "24",
          cache: "",
        });
      });

      it("should return shouldSetup=false when nodeVersion is empty", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: false,
          nodeVersion: "",
          cache: "",
        });
      });
    });

    describe("setupBun adapter", () => {
      it("should return shouldSetup=true and bunVersion when package manager is not pnpm and bunVersion is set", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: true,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "bun",
            nodeVersion: "24",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when bunVersion is empty", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "",
        });
      });
    });

    describe("setupPackageManager adapter", () => {
      it("should extract package manager options for pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "9.0.0" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "pnpm",
          version: "9.0.0",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: true,
        });
      });

      it("should extract package manager options for npm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "npm",
          version: "12",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: false,
        });
      });

      it("should extract package manager options for bun", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "bun",
          version: "1.4",
          pnpmRuntime: "bun@1.4",
          shouldSetupPnpm: false,
        });
      });
    });

    describe("Boundary Separation (Resolver vs Adapter)", () => {
      it("adapters take resolved environment and do not re-trigger workspace detection", () => {
        const existsSpy = vi.spyOn(fs, "existsSync");
        const readSpy = vi.spyOn(fs, "readFileSync");

        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };

        const nodeConfig = setupNode(env);
        const bunConfig = setupBun(env);
        const pmConfig = setupPackageManager(env);
        const pnpmRuntime = resolvePnpmSetupRuntime(env.js);

        expect(nodeConfig).toBeDefined();
        expect(bunConfig).toBeDefined();
        expect(pmConfig).toBeDefined();
        expect(pnpmRuntime).toBe("bun@1.4");

        expect(existsSpy).not.toHaveBeenCalled();
        expect(readSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("resolveEnvironment", () => {
    it("should respect explicit runtime input node@22", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = resolveEnvironment("node@22");

      expect(env.js.runtime).toBe("node");
      expect(env.js.nodeVersion).toBe("22");
      expect(env.js.bunVersion).toBe("");
    });

    it("should respect explicit runtime input bun@1.4", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");
      const env = resolveEnvironment("bun@1.4");

      expect(env.js.runtime).toBe("bun");
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should throw validation error when explicit runtime bun@1.4 is used with npm package manager", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(() => resolveEnvironment("bun@1.4")).toThrow(
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager",
      );
    });

    it("should respect explicit runtime input node@22,bun@1.4 and output versions for both", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = resolveEnvironment("node@22,bun@1.4");

      expect(env.js.runtime).toBe("node");
      expect(env.js.nodeVersion).toBe("22");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=node when explicit runtime=node is supplied even if package manager is bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "bun@1.4" }) as any,
      );

      const env = resolveEnvironment("node");

      expect(env.js.runtime).toBe("node");
      expect(env.js.pm).toEqual({ name: "bun", version: "1.4" });
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=bun when explicit runtime=bun is supplied even if package manager is pnpm", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "pnpm@11.21.0" }) as any,
      );

      const env = resolveEnvironment("bun");

      expect(env.js.runtime).toBe("bun");
      expect(env.js.pm).toEqual({ name: "pnpm", version: "11.21.0" });
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
    });
  });

  describe("Fixture-based tests", () => {
    const cases = [
      {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "npm", version: "12" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: DEFAULT_PNPM_VERSION },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun",
        type: "basic",
        expectedNode: "",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: ">=1.0.0",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun",
        type: "minimal",
        expectedNode: "",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should resolve correct environment for fixture $action/$runtime/$pm/$type",
      ({ action, runtime: rt, pm, type, expectedNode, expectedBun, expectedPm, expectedRuntime }) => {
        const fixturePath = path.join(fixturesDir, action, rt, pm, type);
        process.chdir(fixturePath);

        const env = resolveEnvironment();

        expect(env.js.nodeVersion).toBe(expectedNode);
        expect(env.js.bunVersion).toBe(expectedBun);
        expect(env.js.pm).toEqual(expectedPm);
        expect(env.js.runtime).toBe(expectedRuntime);
      },
    );
  });

  describe("writeOutput", () => {
    it("should consume env.js and env.python directly without re-inspecting filesystem", () => {
      const tempDir = path.join(fixturesDir, "write-output-no-reinspect-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        const existsSpy = vi.spyOn(fs, "existsSync");
        const readSpy = vi.spyOn(fs, "readFileSync");

        writeOutput(env);

        expect(existsSpy).not.toHaveBeenCalled();
        expect(readSpy).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should output node-version, bun-version, package manager, runtime, pnpm-runtime, and adapter step outputs correctly for ResolvedEnvironment", () => {
      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: true,
          project: {} as any,
          pm: { name: "pnpm", version: "9.0.0" },
          runtime: "node",
          nodeVersion: "20.10.0",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "9.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should output all detected values when passed a ResolvedEnvironment object", () => {
      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: true,
          project: {} as any,
          pm: { name: "npm", version: "12" },
          runtime: "node",
          nodeVersion: "24",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "12");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@24");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
    });

    it("should set has-python-source and setup-python to false and clear python outputs when no Python source files exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: false,
          project: {} as any,
          pm: { name: "npm", version: "12" },
          runtime: "node",
          nodeVersion: "24",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
      expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
    });

    it("should set has-python-source and setup-python to true and resolve python outputs when Python source exists", () => {
      const tempDir = path.join(fixturesDir, "python-source-test-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        writeOutput(env);

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.4.2");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should set setup-node to false for Python-only projects without package.json", () => {
      const tempDir = path.join(fixturesDir, "python-only-node-setup-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        writeOutput(env);

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("run", () => {
    it("should coordinate environment resolution, execute adapters, and write action output on fixture project", () => {
      const fixturePath = path.join(fixturesDir, "pages/node/npm/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24.19.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "11.19.0");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
    });

    it("should resolve bun and set adapter outputs for bun project fixture", () => {
      const fixturePath = path.join(fixturesDir, "pages/bun/bun/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "bun");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "1.4");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
      expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should resolve pnpm package manager and set adapter outputs for pnpm fixture in bun runtime", () => {
      const fixturePath = path.join(fixturesDir, "pages/bun/pnpm/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-pnpm-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", ">=1.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "11.21.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should ensure setup-node is false for Python-only project when run() executes", () => {
      const tempDir = path.join(fixturesDir, "python-only-run-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should report failure via core.setFailed if environment resolution throws", () => {
      vi.spyOn(core, "getInput").mockImplementation((name) => {
        if (name === "runtime") return "invalid-runtime";
        return "";
      });

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Environment setup failed:"),
      );
    });
  });

  describe("toolchain resolution inputs", () => {
    it("should resolve toolchain to 'vite-plus' when toolchainInput is 'vite-plus'", () => {
      const fixturePath = path.join(fixturesDir, "pages/node/npm/basic");
      process.chdir(fixturePath);

      const resolved = resolveEnvironment("node", "vite-plus");
      expect(resolved.js.toolchain).toBe("vite-plus");
    });

    it("should resolve toolchain to 'vite' when toolchainInput is 'vite'", () => {
      const fixturePath = path.join(fixturesDir, "vite-plus/node/pnpm/minimal");
      process.chdir(fixturePath);

      const resolved = resolveEnvironment("node", "vite");
      expect(resolved.js.toolchain).toBe("vite");
    });

    it("should auto-detect toolchain when toolchainInput is 'auto' or empty", () => {
      const vpFixture = path.join(fixturesDir, "vite-plus/node/pnpm/minimal");
      process.chdir(vpFixture);
      const resolvedVp = resolveEnvironment("node", "auto");
      expect(resolvedVp.js.toolchain).toBe("vite-plus");

      const stdFixture = path.join(fixturesDir, "pages/node/npm/basic");
      process.chdir(stdFixture);
      const resolvedStd = resolveEnvironment("node", "");
      expect(resolvedStd.js.toolchain).toBe("vite");
    });

    it("should throw INVALID_INPUT when toolchainInput is unsupported", () => {
      expect(() => resolveEnvironment("node", "invalid-toolchain")).toThrow();
    });
  });
});
