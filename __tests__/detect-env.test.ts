import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DetectedEnv } from "../src/detect-env";
import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  detectBunVersion,
  detectEnv,
  detectNodeVersion,
  detectPackageManager,
  detectProjectEnvironment,
  detectRuntime,
  getDefaultPackageManagerVersion,
  getPnpmRuntime,
  parseEnvironmentInputs,
  parseRuntimeInput,
  resolvePackageManager,
  resolvePnpmSetupRuntime,
  resolveRuntime,
  resolveVersions,
  run,
  setupBun,
  setupNode,
  setupPackageManager,
  validateEnvironment,
  writeOutput,
} from "../src/detect-env";

vi.mock("@actions/core");

describe("detect-env", () => {
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
      expect(getDefaultPackageManagerVersion("npm")).toBe("12");
      expect(getDefaultPackageManagerVersion("pnpm")).toBe("12");
      expect(getDefaultPackageManagerVersion("bun")).toBe("1.4");
    });
  });

  describe("Environment Resolution Pipeline", () => {
    describe("parseEnvironmentInputs runtime input validation", () => {
      describe("valid runtime inputs", () => {
        it("should return empty object when runtime input is absent or whitespace-only", () => {
          expect(parseEnvironmentInputs("")).toEqual({});
          expect(parseEnvironmentInputs("   ")).toEqual({});
        });

        it("should parse explicit node runtime without version", () => {
          expect(parseEnvironmentInputs("node")).toEqual({
            specifiedRuntime: "node",
            nodeVersion: undefined,
            bunVersion: undefined,
          });
        });

        it("should parse explicit bun runtime without version", () => {
          expect(parseEnvironmentInputs("bun")).toEqual({
            specifiedRuntime: "bun",
            nodeVersion: undefined,
            bunVersion: DEFAULT_BUN_VERSION,
          });
        });

        it("should parse explicit node version string", () => {
          expect(parseEnvironmentInputs("node@22")).toEqual({
            specifiedRuntime: "node",
            nodeVersion: "22",
            bunVersion: undefined,
          });
        });

        it("should parse explicit bun version string", () => {
          expect(parseEnvironmentInputs("bun@1.4")).toEqual({
            specifiedRuntime: "bun",
            nodeVersion: undefined,
            bunVersion: "1.4",
          });
        });

        it("should parse multi-runtime specifier with comma or space", () => {
          expect(parseEnvironmentInputs("node@24,bun@1.4")).toEqual({
            specifiedRuntime: "node",
            nodeVersion: "24",
            bunVersion: "1.4",
          });

          expect(parseEnvironmentInputs("bun@1.4, node@24")).toEqual({
            specifiedRuntime: "bun",
            nodeVersion: "24",
            bunVersion: "1.4",
          });

          expect(parseEnvironmentInputs("node, bun")).toEqual({
            specifiedRuntime: "node",
            nodeVersion: undefined,
            bunVersion: DEFAULT_BUN_VERSION,
          });
        });

        it("should parse both keyword", () => {
          expect(parseEnvironmentInputs("both")).toEqual({
            specifiedRuntime: undefined,
            nodeVersion: undefined,
            bunVersion: DEFAULT_BUN_VERSION,
          });
        });

        it("should support mixed-case and whitespace-padded inputs", () => {
          expect(parseEnvironmentInputs("  NODE@24  ")).toEqual({
            specifiedRuntime: "node",
            nodeVersion: "24",
            bunVersion: undefined,
          });

          expect(parseEnvironmentInputs("Bun@1.4 , Node@22")).toEqual({
            specifiedRuntime: "bun",
            nodeVersion: "22",
            bunVersion: "1.4",
          });

          expect(parseEnvironmentInputs("BOTH")).toEqual({
            specifiedRuntime: undefined,
            nodeVersion: undefined,
            bunVersion: DEFAULT_BUN_VERSION,
          });
        });
      });

      describe("invalid and malformed runtime inputs", () => {
        it("should reject unknown runtime names", () => {
          expect(() => parseEnvironmentInputs("deno")).toThrow(
            'Invalid runtime input "deno": unrecognized or malformed runtime specifier "deno"',
          );
          expect(() => parseEnvironmentInputs("python")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("invalid")).toThrow("unrecognized or malformed");
        });

        it("should reject prefix or partial runtime matches", () => {
          expect(() => parseEnvironmentInputs("nodedev")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("nodes")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("node-20")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("bunyan")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("buns")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("node18")).toThrow("unrecognized or malformed");
        });

        it("should reject malformed version syntax", () => {
          expect(() => parseEnvironmentInputs("node@")).toThrow("malformed version specifier");
          expect(() => parseEnvironmentInputs("bun@")).toThrow("malformed version specifier");
          expect(() => parseEnvironmentInputs("@24")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("node@@24")).toThrow("malformed version specifier");
          expect(() => parseEnvironmentInputs("node@20@22")).toThrow("malformed version specifier");
        });

        it("should reject malformed comma formatting including whitespace-separated empty segments", () => {
          expect(() => parseEnvironmentInputs(",node")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node,")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node,,bun")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node,, bun")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node, ,bun")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node , , bun")).toThrow("malformed comma placement");
          expect(() => parseEnvironmentInputs("node,   ,bun")).toThrow("malformed comma placement");
        });

        it("should reject duplicate or conflicting specifiers for the same runtime", () => {
          expect(() => parseEnvironmentInputs("node@20, node@22")).toThrow(
            'duplicate or conflicting specifiers for "node"',
          );
          expect(() => parseEnvironmentInputs("node, node")).toThrow(
            'duplicate or conflicting specifiers for "node"',
          );
          expect(() => parseEnvironmentInputs("bun@1.2, bun@1.4")).toThrow(
            'duplicate or conflicting specifiers for "bun"',
          );
          expect(() => parseEnvironmentInputs("both, both")).toThrow(
            'duplicate or conflicting specifiers for "both"',
          );
        });

        it("should reject mixed valid and invalid runtime specifiers", () => {
          expect(() => parseEnvironmentInputs("node@24, deno")).toThrow("unrecognized or malformed");
          expect(() => parseEnvironmentInputs("bun@1.4, invalid")).toThrow("unrecognized or malformed");
        });
      });
    });

    describe("detectProjectEnvironment", () => {
      it("should collect workspace project configuration state", () => {
        vi.spyOn(fs, "existsSync").mockImplementation((p) =>
          [".nvmrc", "package.json"].includes(p as string),
        );
        vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
          if (p === ".nvmrc") return "20.11.0\n" as any;
          if (p === "package.json")
            return JSON.stringify({ packageManager: "pnpm@9.0.0" }) as any;
          return "" as any;
        });

        const proj = detectProjectEnvironment();
        expect(proj.nvmRcVersion).toBe("20.11.0");
        expect(proj.packageJson).toEqual({ packageManager: "pnpm@9.0.0" });
      });
    });

    describe("resolvePackageManager", () => {
      it("should resolve package manager from packageManager field, devEngines, lockfiles, and fallback", () => {
        const pmFromField = resolvePackageManager({
          packageJson: { packageManager: "pnpm@9.5.0" },
          hasPnpmLock: false,
          hasPackageLock: false,
          hasBunLock: false,
        });
        expect(pmFromField).toEqual({ name: "pnpm", version: "9.5.0" });

        const pmFromLock = resolvePackageManager({
          hasPnpmLock: true,
          hasPackageLock: false,
          hasBunLock: false,
        });
        expect(pmFromLock).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION });
      });
    });

    describe("resolveRuntime precedence & defaults", () => {
      it("explicit node + bun PM -> node", () => {
        const runtime = resolveRuntime(
          { specifiedRuntime: "node" },
          { name: "bun", version: "1.4" },
        );
        expect(runtime).toBe("node");
      });

      it("explicit bun + pnpm PM -> bun", () => {
        const runtime = resolveRuntime(
          { specifiedRuntime: "bun" },
          { name: "pnpm", version: "12" },
        );
        expect(runtime).toBe("bun");
      });

      it("no runtime + bun PM -> bun", () => {
        const runtime = resolveRuntime({}, { name: "bun", version: "1.4" });
        expect(runtime).toBe("bun");
      });

      it("no runtime + npm PM -> node", () => {
        const runtime = resolveRuntime({}, { name: "npm", version: "12" });
        expect(runtime).toBe("node");
      });

      it("no runtime + pnpm PM -> node", () => {
        const runtime = resolveRuntime({}, { name: "pnpm", version: "12" });
        expect(runtime).toBe("node");
      });
    });

    describe("resolveVersions & validateEnvironment", () => {
      it("should resolve versions and validate clean env struct", () => {
        const project = {
          hasPnpmLock: true,
          hasPackageLock: false,
          hasBunLock: false,
        };

        const versions = resolveVersions(
          { nodeVersion: "22" },
          { name: "pnpm", version: "12" },
          "node",
          project,
        );

        expect(versions.nodeVersion).toBe("22");

        const env = validateEnvironment({
          nodeVersion: versions.nodeVersion,
          bunVersion: versions.bunVersion,
          pm: { name: "pnpm", version: "12" },
          runtime: "node",
        });

        expect(env.runtime).toBe("node");
        expect(env.nodeVersion).toBe("22");
      });

      it("should throw error in validateEnvironment when runtime or package manager is invalid", () => {
        expect(() =>
          validateEnvironment({
            nodeVersion: "24",
            bunVersion: "",
            pm: { name: "npm", version: "12" },
            runtime: "invalid" as any,
          }),
        ).toThrow("Invalid resolved runtime");

        expect(() =>
          validateEnvironment({
            nodeVersion: "24",
            bunVersion: "",
            pm: { name: "", version: "" },
            runtime: "node",
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

        const run1 = detectEnv("node");
        const run2 = detectEnv("node");

        expect(run1).toEqual(run2);
        expect(run1).toEqual({
          nodeVersion: "22.1.0",
          bunVersion: "",
          pm: { name: "npm", version: DEFAULT_NPM_VERSION },
          runtime: "node",
        });
      });
    });
  });

  describe("detectRuntime", () => {
    it("should detect node when pm is npm and bunVersion is empty", () => {
      const runtime = detectRuntime({ name: "npm", version: "latest" }, "");
      expect(runtime).toBe("node");
    });

    it("should detect bun when pm is bun or bunVersion is present", () => {
      const runtime = detectRuntime({ name: "bun", version: "latest" }, "latest");
      expect(runtime).toBe("bun");
    });

    it("should return bun when pm is npm but bunVersion is non-empty", () => {
      const runtime = detectRuntime({ name: "npm", version: "12" }, "1.4");
      expect(runtime).toBe("bun");
    });
  });

  describe("getPnpmRuntime", () => {
    it("should format bun runtime when bunVersion is non-empty", () => {
      expect(getPnpmRuntime("1.4", "")).toBe("bun@1.4");
      expect(getPnpmRuntime("1.4", "24")).toBe("bun@1.4");
    });

    it("should format node runtime when nodeVersion is non-empty and does not start with lts", () => {
      expect(getPnpmRuntime("", "24")).toBe("node@24");
      expect(getPnpmRuntime("", "22.0.0")).toBe("node@22.0.0");
    });

    it("should format node@lts when nodeVersion starts with lts or is empty", () => {
      expect(getPnpmRuntime("", "lts/*")).toBe("node@lts");
      expect(getPnpmRuntime("", "lts/iron")).toBe("node@lts");
      expect(getPnpmRuntime("", "")).toBe("node@lts");
    });
  });

  describe("Tool-Specific Setup Adapters", () => {
    describe("resolvePnpmSetupRuntime", () => {
      it("should format bun runtime specifier when bunVersion is present", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "24",
            bunVersion: "1.4",
            pm: { name: "pnpm", version: "12" },
            runtime: "bun",
          }),
        ).toBe("bun@1.4");
      });

      it("should format node runtime specifier when nodeVersion is present and not lts", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "22.1.0",
            bunVersion: "",
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
          }),
        ).toBe("node@22.1.0");
      });

      it("should format node@lts when nodeVersion starts with lts or is empty", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "lts/iron",
            bunVersion: "",
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
          }),
        ).toBe("node@lts");

        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "",
            bunVersion: "",
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
          }),
        ).toBe("node@lts");
      });
    });

    describe("setupNode adapter", () => {
      it("should return correct setup options for npm package manager", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "",
          pm: { name: "npm", version: "12" },
          runtime: "node",
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "24",
          cache: "npm",
        });
      });

      it("should return correct setup options for bun package manager with node runtime", () => {
        const env: DetectedEnv = {
          nodeVersion: "22",
          bunVersion: "1.4",
          pm: { name: "bun", version: "1.4" },
          runtime: "node",
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "22",
          cache: "",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "",
          pm: { name: "pnpm", version: "12" },
          runtime: "node",
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: false,
          nodeVersion: "24",
          cache: "",
        });
      });

      it("should return shouldSetup=false when nodeVersion is empty", () => {
        const env: DetectedEnv = {
          nodeVersion: "",
          bunVersion: "1.4",
          pm: { name: "bun", version: "1.4" },
          runtime: "bun",
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
        const env: DetectedEnv = {
          nodeVersion: "",
          bunVersion: "1.4",
          pm: { name: "bun", version: "1.4" },
          runtime: "bun",
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: true,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "1.4",
          pm: { name: "pnpm", version: "12" },
          runtime: "bun",
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when bunVersion is empty", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "",
          pm: { name: "npm", version: "12" },
          runtime: "node",
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "",
        });
      });
    });

    describe("setupPackageManager adapter", () => {
      it("should extract package manager options for pnpm", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "",
          pm: { name: "pnpm", version: "9.0.0" },
          runtime: "node",
        };
        expect(setupPackageManager(env)).toEqual({
          name: "pnpm",
          version: "9.0.0",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: true,
        });
      });

      it("should extract package manager options for npm", () => {
        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "",
          pm: { name: "npm", version: "12" },
          runtime: "node",
        };
        expect(setupPackageManager(env)).toEqual({
          name: "npm",
          version: "12",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: false,
        });
      });

      it("should extract package manager options for bun", () => {
        const env: DetectedEnv = {
          nodeVersion: "",
          bunVersion: "1.4",
          pm: { name: "bun", version: "1.4" },
          runtime: "bun",
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

        const env: DetectedEnv = {
          nodeVersion: "24",
          bunVersion: "1.4",
          pm: { name: "pnpm", version: "12" },
          runtime: "node",
        };

        const nodeConfig = setupNode(env);
        const bunConfig = setupBun(env);
        const pmConfig = setupPackageManager(env);
        const pnpmRuntime = resolvePnpmSetupRuntime(env);

        expect(nodeConfig).toBeDefined();
        expect(bunConfig).toBeDefined();
        expect(pmConfig).toBeDefined();
        expect(pnpmRuntime).toBe("bun@1.4");

        expect(existsSpy).not.toHaveBeenCalled();
        expect(readSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("detectNodeVersion", () => {
    it("should return version from .nvmrc if it exists and trim whitespace", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".nvmrc");
      vi.spyOn(fs, "readFileSync").mockReturnValue("  20.11.0\n" as any);

      expect(detectNodeVersion()).toBe("20.11.0");
      expect(core.info).toHaveBeenCalledWith("Found .nvmrc: 20.11.0");
    });

    it("should return version from .node-version if .nvmrc does not exist and .node-version exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".node-version");
      vi.spyOn(fs, "readFileSync").mockReturnValue(" 22.0.0 \n" as any);

      expect(detectNodeVersion()).toBe("22.0.0");
      expect(core.info).toHaveBeenCalledWith("Found .node-version: 22.0.0");
    });

    it("should return Node.js version from package.json devEngines if nvmrc and node-version are missing", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { runtime: { name: "node", version: ">=20.0.0" } } }) as any,
      );

      expect(detectNodeVersion()).toBe(">=20.0.0");
      expect(core.info).toHaveBeenCalledWith(
        "Found Node.js version in package.json devEngines: >=20.0.0",
      );
    });

    it("should return empty string and not log recommendation if package manager is bun and no node config exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}) as any);

      expect(detectNodeVersion("bun")).toBe("");
      expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using 24");
    });

    it("should return version from .nvmrc for detectNodeVersion('bun') if .nvmrc exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".nvmrc");
      vi.spyOn(fs, "readFileSync").mockReturnValue("20.11.0\n" as any);

      expect(detectNodeVersion("bun")).toBe("20.11.0");
    });

    it("should return version from .node-version for detectNodeVersion('bun') if .node-version exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".node-version");
      vi.spyOn(fs, "readFileSync").mockReturnValue("22.0.0\n" as any);

      expect(detectNodeVersion("bun")).toBe("22.0.0");
    });

    it("should return version from package.json devEngines for detectNodeVersion('bun') if devEngines node exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { runtime: { name: "node", version: "20.0.0" } } }) as any,
      );

      expect(detectNodeVersion("bun")).toBe("20.0.0");
    });

    it("should fall back to 24 if package.json exists but devEngines is missing for non-bun package manager", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}) as any);

      expect(detectNodeVersion("npm")).toBe("24");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using 24");
    });

    it("should catch JSON parsing errors or other read errors and warn, then fall back to 24 for non-bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("SyntaxError: Unexpected token");
      });

      expect(detectNodeVersion("npm")).toBe("24");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: SyntaxError: Unexpected token",
      );
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using 24");
    });

    it("should catch non-Error exceptions gracefully during detection", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Raw string error";
      });

      expect(detectNodeVersion()).toBe("24");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: Raw string error",
      );
    });

    it("should fall back to 24 if no node configuration files exist and pm is not bun", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(detectNodeVersion()).toBe("24");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using 24");
    });
  });

  describe("detectBunVersion", () => {
    it("should detect version from .bun-version if present", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".bun-version");
      vi.spyOn(fs, "readFileSync").mockReturnValue(" 1.1.20 \n" as any);

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe("1.1.20");
      expect(core.info).toHaveBeenCalledWith("Found .bun-version: 1.1.20");
    });

    it("should return pm.version when pm.name is bun and version is not latest", () => {
      const pm = { name: "bun", version: "1.1.20" };
      expect(detectBunVersion(pm)).toBe("1.1.20");
    });

    it("should detect devEngines.runtime bun from package.json if pm.name is not bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { runtime: { name: "bun", version: ">=1.1.0" } } }) as any,
      );

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe(">=1.1.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in package.json devEngines: >=1.1.0");
    });

    it("should fall back to 1.4 if bun lockfile exists and no specific version was specified", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe("1.4");
    });

    it("should return empty string if pm is not bun and bun is not detected", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe("");
    });
  });

  describe("parseRuntimeInput", () => {
    it("should parse node@24 format", () => {
      const result = parseRuntimeInput("node@24");
      expect(result).toEqual({
        specifiedRuntime: "node",
        nodeVersion: "24",
        bunVersion: undefined,
      });
    });

    it("should parse bun@1.4 format", () => {
      const result = parseRuntimeInput("bun@1.4");
      expect(result).toEqual({
        specifiedRuntime: "bun",
        nodeVersion: undefined,
        bunVersion: "1.4",
      });
    });

    it("should parse node@24,bun@1.4 format", () => {
      const result = parseRuntimeInput("node@24,bun@1.4");
      expect(result).toEqual({
        specifiedRuntime: "node",
        nodeVersion: "24",
        bunVersion: "1.4",
      });
    });

    it("should parse both keyword", () => {
      const result = parseRuntimeInput("both");
      expect(result).toEqual({
        specifiedRuntime: undefined,
        nodeVersion: undefined,
        bunVersion: "1.4",
      });
    });

    it("should return empty object for empty input", () => {
      expect(parseRuntimeInput("")).toEqual({});
    });
  });

  describe("detectPackageManager", () => {
    it("should detect packageManager without version in package.json and use default version for that PM", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ packageManager: "bun" }) as any);

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: "1.4" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: bun@1.4");
    });

    it("should detect packageManager from package.json devEngines if packageManager field is missing", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { packageManager: { name: "pnpm", version: "9.0.0" } } }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "9.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json devEngines: pnpm@9.0.0");
    });


    it("should check fallback lockfiles in order: pnpm-lock.yaml", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "pnpm-lock.yaml");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION });
      expect(core.info).toHaveBeenCalledWith(
        `Found pnpm-lock.yaml, using pnpm@${DEFAULT_PNPM_VERSION}`,
      );
    });

    it("should check fallback lockfiles in order: package-lock.json", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package-lock.json");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "12" });
      expect(core.info).toHaveBeenCalledWith("Found package-lock.json, using npm@12");
    });

    it("should check fallback lockfiles in order: bun.lock", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: "1.4" });
      expect(core.info).toHaveBeenCalledWith("Found bun lockfile, using bun@1.4");
    });

    it("should fallback to default npm@12 if no lockfiles or configuration exists", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "12" });
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@12");
    });

    it("should handle JSON parser errors or read errors gracefully and use npm fallback", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Broken File System");
      });

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "12" });
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect package manager: Broken File System",
      );
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@12");
    });

    it("should handle raw exceptions gracefully inside detectPackageManager", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Unexpected raw string error";
      });

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "12" });
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect package manager: Unexpected raw string error",
      );
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@12");
    });
  });

  describe("detectEnv", () => {
    it("should respect explicit runtime input node@22", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = detectEnv("node@22");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe("22");
      expect(env.bunVersion).toBe("");
    });

    it("should respect explicit runtime input bun@1.4", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");
      const env = detectEnv("bun@1.4");

      expect(env.runtime).toBe("bun");
      expect(env.nodeVersion).toBe("");
      expect(env.bunVersion).toBe("1.4");
    });

    it("should throw validation error when explicit runtime bun@1.4 is used with npm package manager", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(() => detectEnv("bun@1.4")).toThrow(
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager",
      );
    });

    it("should respect explicit runtime input node@22,bun@1.4 and output versions for both", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = detectEnv("node@22,bun@1.4");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe("22");
      expect(env.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=node when explicit runtime=node is supplied even if package manager is bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "bun@1.4" }) as any,
      );

      const env = detectEnv("node");

      expect(env.runtime).toBe("node");
      expect(env.pm).toEqual({ name: "bun", version: "1.4" });
      expect(env.nodeVersion).toBe("");
      expect(env.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=bun when explicit runtime=bun is supplied even if package manager is pnpm", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "pnpm@11.21.0" }) as any,
      );

      const env = detectEnv("bun");

      expect(env.runtime).toBe("bun");
      expect(env.pm).toEqual({ name: "pnpm", version: "11.21.0" });
      expect(env.nodeVersion).toBe("");
      expect(env.bunVersion).toBe("1.4");
    });
  });

  describe("Fixture-based tests", () => {
    const cases = [
      {
        action: "astro",
        runtime: "node",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        runtime: "node",
        pm: "npm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "npm", version: "12" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        runtime: "node",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        runtime: "node",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: DEFAULT_PNPM_VERSION },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        runtime: "bun",
        pm: "bun",
        type: "basic",
        expectedNode: "",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "astro",
        runtime: "bun",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: ">=1.0.0",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        runtime: "bun",
        pm: "bun",
        type: "minimal",
        expectedNode: "",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "lint-format",
        runtime: "node",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "lint-format",
        runtime: "node",
        pm: "pnpm",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "vite",
        runtime: "node",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "vite-plus",
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
      "should detect correct environment for fixture $action/$runtime/$pm/$type",
      ({ action, runtime: rt, pm, type, expectedNode, expectedBun, expectedPm, expectedRuntime }) => {
        const fixturePath = path.join(fixturesDir, action, rt, pm, type);
        process.chdir(fixturePath);

        const env = detectEnv();

        expect(env.nodeVersion).toBe(expectedNode);
        expect(env.bunVersion).toBe(expectedBun);
        expect(env.pm).toEqual(expectedPm);
        expect(env.runtime).toBe(expectedRuntime);
      },
    );
  });

  describe("Environment Contract focused precedence and conflicting configuration", () => {
    it("explicit runtime input overrides project configuration files (.nvmrc, .bun-version, package.json)", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        [".nvmrc", ".bun-version", "package.json"].includes(p as string),
      );
      vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
        if (p === ".nvmrc") return "22.0.0\n" as any;
        if (p === ".bun-version") return "1.4.0\n" as any;
        if (p === "package.json") return JSON.stringify({ packageManager: "npm@10.0.0" }) as any;
        return "" as any;
      });

      const env = detectEnv("node@20,bun@1.2");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe("20");
      expect(env.bunVersion).toBe("1.2");
      expect(env.pm).toEqual({ name: "npm", version: "10.0.0" });
    });

    it("explicit runtime input node@22 overrides bun packageManager default runtime", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "bun@1.4" }) as any,
      );

      const env = detectEnv("node@22");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe("22");
      expect(env.bunVersion).toBe("1.4");
      expect(env.pm).toEqual({ name: "bun", version: "1.4" });
    });

    it("packageManager field takes precedence over devEngines.packageManager", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          packageManager: "pnpm@9.0.0",
          devEngines: { packageManager: { name: "npm", version: "10.0.0" } },
        }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "9.0.0" });
    });

    it(".nvmrc takes precedence over .node-version and devEngines.runtime", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        [".nvmrc", ".node-version", "package.json"].includes(p as string),
      );
      vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
        if (p === ".nvmrc") return "20.10.0\n" as any;
        if (p === ".node-version") return "22.0.0\n" as any;
        if (p === "package.json")
          return JSON.stringify({ devEngines: { runtime: "node@24" } }) as any;
        return "" as any;
      });

      expect(detectNodeVersion()).toBe("20.10.0");
    });

    it(".node-version takes precedence over devEngines.runtime when .nvmrc is absent", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        [".node-version", "package.json"].includes(p as string),
      );
      vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
        if (p === ".node-version") return "22.0.0\n" as any;
        if (p === "package.json")
          return JSON.stringify({ devEngines: { runtime: "node@24" } }) as any;
        return "" as any;
      });

      expect(detectNodeVersion()).toBe("22.0.0");
    });

    it("devEngines.runtime takes precedence over devEngines.node", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          devEngines: {
            runtime: "node@18.0.0",
            node: "16.0.0",
          },
        }) as any,
      );

      expect(detectNodeVersion()).toBe("18.0.0");
    });

    it("lockfile precedence: pnpm-lock.yaml beats package-lock.json and bun.lock", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        ["pnpm-lock.yaml", "package-lock.json", "bun.lock"].includes(p as string),
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION });
    });

    it("lockfile precedence: package-lock.json beats bun.lock", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        ["package-lock.json", "bun.lock"].includes(p as string),
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
    });

    it("lockfile precedence: bun.lockb alone resolves to bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lockb");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: DEFAULT_BUN_VERSION });
    });

    it("handles package manager specified without an explicit version tag", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");

      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "pnpm" }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION });

      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "bun" }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "bun", version: DEFAULT_BUN_VERSION });

      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "npm" }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
    });

    it("handles Bun runtime specified with non-Bun package manager (pnpm)", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          packageManager: "pnpm@11.21.0",
          devEngines: { runtime: "bun@1.4" },
        }) as any,
      );

      const env = detectEnv("bun");

      expect(env.runtime).toBe("bun");
      expect(env.pm).toEqual({ name: "pnpm", version: "11.21.0" });
      expect(env.bunVersion).toBe("1.4");
      expect(env.nodeVersion).toBe("");
    });

    it("parses devEngines.packageManager in string, object, and array forms", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");

      // Array form
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { packageManager: ["pnpm@9.1.0", "npm@10.0.0"] } }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: "9.1.0" });

      // Object form
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { packageManager: { name: "pnpm", version: "9.2.0" } } }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: "9.2.0" });

      // String form
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { packageManager: "pnpm@9.3.0" } }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: "9.3.0" });

      // devEngines[pm] object form
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { pnpm: { version: "9.4.0" } } }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: "9.4.0" });

      // devEngines[pm] string form
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { pnpm: "9.5.0" } }) as any,
      );
      expect(detectPackageManager()).toEqual({ name: "pnpm", version: "9.5.0" });
    });

    it("parses devEngines.runtime in string, object, and array forms for Node and Bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");

      // Array of strings
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ devEngines: { runtime: ["node@20.0.0", "bun@1.2.0"] } }) as any,
      );
      const pm = { name: "npm", version: "12" };
      expect(detectNodeVersion("npm")).toBe("20.0.0");
      expect(detectBunVersion(pm)).toBe("1.2.0");

      // Array of objects
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          devEngines: {
            runtime: [
              { name: "node", version: "22.1.0" },
              { name: "bun", version: "1.3.1" },
            ],
          },
        }) as any,
      );
      expect(detectNodeVersion("npm")).toBe("22.1.0");
      expect(detectBunVersion(pm)).toBe("1.3.1");

      // devEngines.node and devEngines.bun direct objects
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          devEngines: {
            node: { version: "24.1.0" },
            bun: { version: "1.4.2" },
          },
        }) as any,
      );
      expect(detectNodeVersion("npm")).toBe("24.1.0");
      expect(detectBunVersion(pm)).toBe("1.4.2");
    });

    it("devEngines.[pm] precedence: devEngines.pnpm beats devEngines.npm and devEngines.bun when all are present", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          devEngines: {
            pnpm: "9.1.0",
            npm: "10.0.0",
            bun: "1.4.0",
          },
        }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "9.1.0" });
    });

    it("parses runtime = 'both' to set bunVersion while defaulting runtime to node", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env = detectEnv("both");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe(DEFAULT_NODE_VERSION);
      expect(env.bunVersion).toBe(DEFAULT_BUN_VERSION);
    });

    it("evaluates runtime input order: node@20,bun@1.2 sets specifiedRuntime to node, bun@1.2,node@20 sets specifiedRuntime to bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");

      const env1 = detectEnv("node@20,bun@1.2");
      expect(env1.runtime).toBe("node");
      expect(env1.nodeVersion).toBe("20");
      expect(env1.bunVersion).toBe("1.2");

      const env2 = detectEnv("bun@1.2,node@20");
      expect(env2.runtime).toBe("bun");
      expect(env2.nodeVersion).toBe("20");
      expect(env2.bunVersion).toBe("1.2");
    });

    it("preserves project Node version when runtime input is 'node' without version tag, and sets default Bun version when runtime input is 'bun' without version tag", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        [".nvmrc", ".bun-version", "bun.lock"].includes(p as string),
      );
      vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
        if (p === ".nvmrc") return "20.11.0\n" as any;
        if (p === ".bun-version") return "1.3.5\n" as any;
        return "" as any;
      });

      // runtime = "node" without @version -> keeps detected .nvmrc version
      const envNode = detectEnv("node");
      expect(envNode.runtime).toBe("node");
      expect(envNode.nodeVersion).toBe("20.11.0");

      // runtime = "bun" without @version -> parseRuntimeInput resolves bunVersion to DEFAULT_BUN_VERSION ("1.4")
      const envBun = detectEnv("bun");
      expect(envBun.runtime).toBe("bun");
      expect(envBun.bunVersion).toBe(DEFAULT_BUN_VERSION);
      expect(envBun.nodeVersion).toBe("");
    });

    it("explicit runtime input with @version consistently overrides detected project versions", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) =>
        [".nvmrc", ".bun-version", "bun.lock"].includes(p as string),
      );
      vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
        if (p === ".nvmrc") return "20.11.0\n" as any;
        if (p === ".bun-version") return "1.1.0\n" as any;
        return "" as any;
      });

      const envNodeOverride = detectEnv("node@22");
      expect(envNodeOverride.nodeVersion).toBe("22");

      const envBunOverride = detectEnv("bun@1.4");
      expect(envBunOverride.bunVersion).toBe("1.4");

      const envBothOverride = detectEnv("node@22,bun@1.4");
      expect(envBothOverride.nodeVersion).toBe("22");
      expect(envBothOverride.bunVersion).toBe("1.4");
    });

    it("falls back to default versions when no configuration or lockfiles exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env = detectEnv("");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe(DEFAULT_NODE_VERSION);
      expect(env.bunVersion).toBe("");
      expect(env.pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
    });
  });

  describe("writeOutput", () => {
    it("should output node-version, bun-version, package manager, runtime, pnpm-runtime, and adapter step outputs correctly for positional arguments", () => {
      writeOutput("20.10.0", { name: "pnpm", version: "9.0.0" }, "", "node");

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

    it("should output all detected values when passed a DetectedEnv object", () => {
      const env: DetectedEnv = {
        nodeVersion: "24",
        bunVersion: "",
        pm: { name: "npm", version: "12" },
        runtime: "node",
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

    it("should throw a clear error when string first argument is provided without package manager parameter", () => {
      expect(() => (writeOutput as any)("24")).toThrow(
        "Missing package manager parameter in writeOutput",
      );
    });
  });

  describe("run", () => {
    it("should coordinate environment detection, execute adapters, and write action output on fixture project", () => {
      const fixturePath = path.join(fixturesDir, "astro/node/npm/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
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

    it("should detect bun and set adapter outputs for bun project fixture", () => {
      const fixturePath = path.join(fixturesDir, "astro/bun/bun/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
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

    it("should detect pnpm package manager and set adapter outputs for pnpm fixture in bun runtime", () => {
      const fixturePath = path.join(fixturesDir, "astro/bun/pnpm/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
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
  });
});
