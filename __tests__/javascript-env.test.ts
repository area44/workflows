import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as core from "@actions/core";
import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getDevEngineRuntimeVersion,
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  isSupportedPackageManager,
  isSupportedRuntime,
  parseEnvironmentInputs,
  resolveBunVersion,
  resolveJsEnvironment,
  resolveJsPackageManager,
  resolveNodeVersion,
  resolveRuntime,
  resolveToolchain,
  resolveVersions,
  sanitizePackageManager,
  selectAutofixScripts,
  validateRuntimePackageManagerCompatibility,
} from "../src/javascript-env";

vi.mock("@actions/core");

describe("javascript-env", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "temp-js-env-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("resolveJsEnvironment", () => {
    it("should resolve full JS environment for a project with package.json and pnpm lockfile", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "my-app", packageManager: "pnpm@9.1.0" }),
      );
      fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20.10.0\n");

      const res = resolveJsEnvironment("node", "vite", tempDir);
      expect(res.hasJsProject).toBe(true);
      expect(res.pm).toEqual({ name: "pnpm", version: "9.1.0", source: "packageManager" });
      expect(res.runtime).toBe("node");
      expect(res.nodeVersion).toBe("20.10.0");
      expect(res.toolchain).toBe("vite");

      expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
      expect(core.info).toHaveBeenCalledWith("Resolved runtime: Node.js.");
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: pnpm@9.1.0");
      expect(core.info).toHaveBeenCalledWith("Found .nvmrc: 20.10.0");
    });

    it("should suppress JS detection logs when package.json is absent", () => {
      const res = resolveJsEnvironment("node", "vite", tempDir);
      expect(res.hasJsProject).toBe(false);
      expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining("Package manager not specified"),
      );
      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining("Node.js version not specified"),
      );
    });

    it("should suppress JS warnings and logs in Python-only project with stray .bun-version or .nvmrc", () => {
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')");
      fs.writeFileSync(path.join(tempDir, ".bun-version"), "1.2.0");
      fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20.10.0");

      const res = resolveJsEnvironment("node", "vite", tempDir);
      expect(res.hasJsProject).toBe(false);
      expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Found .bun-version"));
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Found .nvmrc"));
      expect(core.warning).not.toHaveBeenCalled();
    });
  });

  describe("isSupportedRuntime & validateRuntimePackageManagerCompatibility", () => {
    it("should identify supported runtimes", () => {
      expect(isSupportedRuntime("node")).toBe(true);
      expect(isSupportedRuntime("bun")).toBe(true);
      expect(isSupportedRuntime("deno")).toBe(false);
      expect(isSupportedRuntime("python")).toBe(false);
    });

    it("should validate valid runtime and package manager combinations", () => {
      expect(() => validateRuntimePackageManagerCompatibility("node", "npm")).not.toThrow();
      expect(() => validateRuntimePackageManagerCompatibility("node", "pnpm")).not.toThrow();
      expect(() => validateRuntimePackageManagerCompatibility("node", "bun")).not.toThrow();
      expect(() => validateRuntimePackageManagerCompatibility("bun", "bun")).not.toThrow();
      expect(() => validateRuntimePackageManagerCompatibility("bun", "pnpm")).not.toThrow();
    });

    it("should throw for unsupported runtime", () => {
      expect(() => validateRuntimePackageManagerCompatibility("deno", "npm")).toThrow(
        'Unsupported runtime "deno"',
      );
    });

    it("should throw for unsupported package manager", () => {
      expect(() => validateRuntimePackageManagerCompatibility("node", "yarn")).toThrow(
        'Unsupported package manager "yarn"',
      );
    });

    it("should throw when bun runtime is paired with npm", () => {
      expect(() => validateRuntimePackageManagerCompatibility("bun", "npm")).toThrow(
        "Bun runtime does not support npm package manager",
      );
    });
  });

  describe("parseEnvironmentInputs", () => {
    describe("valid runtime inputs", () => {
      it("should return empty object for empty or whitespace-only input", () => {
        expect(parseEnvironmentInputs("")).toEqual({});
        expect(parseEnvironmentInputs("   ")).toEqual({});
      });

      it("should parse explicit node runtime without version", () => {
        expect(parseEnvironmentInputs("node")).toEqual({
          specifiedRuntime: "node",
        });
      });

      it("should parse explicit bun runtime without version", () => {
        expect(parseEnvironmentInputs("bun")).toEqual({
          specifiedRuntime: "bun",
        });
      });

      it("should parse explicit node version string", () => {
        expect(parseEnvironmentInputs("node@22")).toEqual({
          specifiedRuntime: "node",
          nodeVersion: "22",
        });
      });

      it("should parse explicit bun version string", () => {
        expect(parseEnvironmentInputs("bun@1.4")).toEqual({
          specifiedRuntime: "bun",
          bunVersion: "1.4",
        });
      });

      it("should support mixed-case and whitespace-padded inputs", () => {
        expect(parseEnvironmentInputs("  NODE@24  ")).toEqual({
          specifiedRuntime: "node",
          nodeVersion: "24",
        });

        expect(parseEnvironmentInputs("  Bun@1.4  ")).toEqual({
          specifiedRuntime: "bun",
          bunVersion: "1.4",
        });
      });
    });

    describe("invalid and malformed runtime inputs", () => {
      const invalidInputs = [
        "both",
        "BOTH",
        " Both ",
        "node, bun",
        "bun, node",
        "node@24, bun@1.4",
        "node@",
        "bun@",
        "node@24@25",
        "bun@@1.4",
        "deno",
        "python",
        "npm",
        "node 24",
        "node@24 extra",
        ",node",
        "node,",
        "node@20@22?secret=token_12345",
      ];

      it.each(invalidInputs)("should reject invalid runtime input: %p", (input) => {
        expect(() => parseEnvironmentInputs(input)).toThrow(
          "Invalid runtime input. Supported values are 'node', 'bun', 'node@<version>', and 'bun@<version>'.",
        );
      });

      it("should sanitize sensitive values in malformed or unrecognized runtime input error messages", () => {
        const sensitiveToken = "ghp_1234567890abcdefghijklmnopqrstuv";
        const inputWithToken = `node@24?token=${sensitiveToken}`;
        let caughtError: Error | undefined;
        try {
          parseEnvironmentInputs(inputWithToken);
        } catch (err) {
          caughtError = err as Error;
        }
        expect(caughtError).toBeDefined();
        expect(caughtError?.message).not.toContain(sensitiveToken);
        expect(caughtError?.message).toBe(
          "Invalid runtime input. Supported values are 'node', 'bun', 'node@<version>', and 'bun@<version>'.",
        );
      });
    });
  });

  describe("resolveToolchain", () => {
    it("should resolve toolchain correctly and sanitize unknown toolchain inputs", () => {
      expect(resolveToolchain("vite")).toBe("vite");
      expect(resolveToolchain("vite-plus")).toBe("vite-plus");
      expect(resolveToolchain("auto")).toBe("vite");

      const sensitiveToolchainInput = "invalid_toolchain_token_xyz123";
      let err: Error | undefined;
      try {
        resolveToolchain(sensitiveToolchainInput);
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err?.message).not.toContain(sensitiveToolchainInput);
      expect(err?.message).toBe(
        'Invalid toolchain input: unsupported value. Supported values are "auto", "vite", or "vite-plus".',
      );
    });
  });

  describe("resolveRuntime", () => {
    it("should prioritize specifiedRuntime over package manager", () => {
      expect(
        resolveRuntime({ specifiedRuntime: "node" }, { name: "bun", version: "1.4" }),
      ).toBe("node");
      expect(
        resolveRuntime({ specifiedRuntime: "bun" }, { name: "pnpm", version: "12" }),
      ).toBe("bun");
    });

    it("should resolve bun runtime when package manager is bun and no specifiedRuntime is provided", () => {
      expect(resolveRuntime({}, { name: "bun", version: "1.4" })).toBe("bun");
    });

    it("should resolve node runtime when package manager is npm or pnpm and no specifiedRuntime is provided", () => {
      expect(resolveRuntime({}, { name: "npm", version: "12" })).toBe("node");
      expect(resolveRuntime({}, { name: "pnpm", version: "12" })).toBe("node");
    });
  });

  describe("resolveNodeVersion & resolveBunVersion & resolveVersions", () => {
    it("should resolve node and bun versions based on project state and precedence", () => {
      const project = {
        hasPackageJson: true,
        nvmRcVersion: "20.10.0",
        nodeFileVersion: "22.0.0",
        bunFileVersion: "1.2.0",
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };

      const pm = { name: "npm", version: "12" };

      expect(resolveNodeVersion({}, pm, "node", project)).toBe("20.10.0");
      expect(resolveBunVersion({}, pm, project)).toBe("1.2.0");

      const versions = resolveVersions({ nodeVersion: "24" }, pm, "node", project);
      expect(versions).toEqual({ nodeVersion: "24", bunVersion: "1.2.0" });
    });

    it("should fall back to defaults when no version files or configs exist", () => {
      const emptyProject = {
        hasPackageJson: false,
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };

      expect(resolveNodeVersion({}, { name: "npm", version: "12" }, "node", emptyProject)).toBe(
        DEFAULT_NODE_VERSION,
      );
      expect(resolveBunVersion({}, { name: "bun", version: "1.4" }, emptyProject)).toBe(
        DEFAULT_BUN_VERSION,
      );
    });

    it("should preserve 'latest' when packageManager specifies bun@latest and log Found Bun version in packageManager: latest", () => {
      const project = {
        hasPackageJson: true,
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "latest" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("latest");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in packageManager: latest");
    });

    it("should respect concrete Bun version in packageManager and log it", () => {
      const project = {
        hasPackageJson: true,
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "1.2.0", source: "packageManager" as const };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.2.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in packageManager: 1.2.0");
    });

    it("regression test: should prefer devEngines.bun version over lockfile-derived default Bun version when packageManager is absent", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { bun: "1.3.0" } }),
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);

      expect(pm.name).toBe("bun");
      expect(pm.source).toBe("lockfile");

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.3.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in package.json devEngines: 1.3.0");
    });

    it("should respect .bun-version file and log it", () => {
      const project = {
        hasPackageJson: true,
        bunFileVersion: "1.1.0",
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };
      const pm = { name: "npm", version: "12" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.1.0");
      expect(core.info).toHaveBeenCalledWith("Found .bun-version: 1.1.0");
    });

    it("should respect Bun version in package.json devEngines and log it", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };
      const pm = { name: "npm", version: "12" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.3.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in package.json devEngines: 1.3.0");
    });

    it("should prioritize explicit action input for Bun version over project config", () => {
      const project = {
        hasPackageJson: true,
        bunFileVersion: "1.1.0",
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };
      const pm = { name: "bun", version: "1.2.0" };

      const ver = resolveBunVersion({ bunVersion: "1.4.1" }, pm, project);
      expect(ver).toBe("1.4.1");
      expect(core.info).toHaveBeenCalledWith("Resolved Bun version from input: 1.4.1");
    });

    it("regression test: runtime selection 'bun' should defer to .bun-version file and not override with default Bun version", () => {
      const parsed = parseEnvironmentInputs("bun");
      expect(parsed.bunVersion).toBeUndefined();

      const project = {
        hasPackageJson: true,
        bunFileVersion: "1.2.0",
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "DEFAULT_BUN_VERSION", source: "lockfile" as const };

      const ver = resolveBunVersion(parsed, pm, project);
      expect(ver).toBe("1.2.0");
      expect(core.info).toHaveBeenCalledWith("Found .bun-version: 1.2.0");
    });

    it("regression test: runtime selection 'bun' should defer to devEngines.bun and not override with default Bun version", () => {
      const parsed = parseEnvironmentInputs("bun");
      expect(parsed.bunVersion).toBeUndefined();

      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "DEFAULT_BUN_VERSION", source: "lockfile" as const };

      const ver = resolveBunVersion(parsed, pm, project);
      expect(ver).toBe("1.3.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in package.json devEngines: 1.3.0");
    });

    it("regression test: runtime selection 'bun' should defer to .bun-version and devEngines.bun", () => {
      const parsed = parseEnvironmentInputs("bun");
      expect(parsed.bunVersion).toBeUndefined();

      const project = {
        hasPackageJson: true,
        bunFileVersion: "1.1.5",
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: false,
      };
      const pm = { name: "npm", version: "12", source: "default" as const };

      const ver = resolveBunVersion(parsed, pm, project);
      expect(ver).toBe("1.1.5");
      expect(core.info).toHaveBeenCalledWith("Found .bun-version: 1.1.5");
    });

    it("regression test: runtime selection 'node' should defer to .nvmrc and devEngines.node", () => {
      const parsed = parseEnvironmentInputs("node");
      expect(parsed.nodeVersion).toBeUndefined();

      const project = {
        hasPackageJson: true,
        nvmRcVersion: "20.10.0",
        packageJson: { devEngines: { node: "22.0.0" } },
        hasPnpmLock: false,
        hasPackageLock: true,
        hasBunLock: false,
      };
      const pm = { name: "npm", version: "12", source: "default" as const };

      const ver = resolveNodeVersion(parsed, pm, "node", project);
      expect(ver).toBe("20.10.0");
      expect(core.info).toHaveBeenCalledWith("Found .nvmrc: 20.10.0");
    });

    it("should prioritize .bun-version file over packageManager field (including bun@latest) and devEngines", () => {
      const project = {
        hasPackageJson: true,
        bunFileVersion: "1.1.0",
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "latest" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.1.0");
      expect(core.info).toHaveBeenCalledWith("Found .bun-version: 1.1.0");
    });

    it("should prioritize packageManager 'bun@latest' over concrete devEngines.bun version", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "latest" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("latest");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in packageManager: latest");
    });

    it("should prioritize packageManager concrete version over devEngines.bun version", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { bun: "1.3.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      const pm = { name: "bun", version: "1.2.0" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("1.2.0");
      expect(core.info).toHaveBeenCalledWith("Found Bun version in packageManager: 1.2.0");
    });

    it("should not emit Bun fallback logs for a project without Bun detection", () => {
      const project = {
        hasPackageJson: true,
        hasPnpmLock: false,
        hasPackageLock: true,
        hasBunLock: false,
      };
      const pm = { name: "npm", version: "12" };

      const ver = resolveBunVersion({}, pm, project);
      expect(ver).toBe("");
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Bun version"));
    });
  });

  describe("sanitizePackageManager", () => {
    it("should allow valid package manager names", () => {
      expect(sanitizePackageManager("npm")).toBe("npm");
      expect(sanitizePackageManager("pnpm")).toBe("pnpm");
      expect(sanitizePackageManager("bun")).toBe("bun");
      expect(sanitizePackageManager("pnpm-10")).toBe("pnpm-10");
    });

    it("should sanitize untrusted input containing shell injection", () => {
      expect(sanitizePackageManager("npm; calc")).toBe("npm");
      expect(sanitizePackageManager("pnpm && echo hack")).toBe("npm");
      expect(sanitizePackageManager("bun || rm -rf /")).toBe("npm");
    });
  });

  describe("inspectJsProjectEnvironment", () => {
    it("should detect package.json, .nvmrc, .node-version, and .bun-version", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg" }));
      fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20.10.0\n");
      fs.writeFileSync(path.join(tempDir, ".node-version"), "22.0.0\n");
      fs.writeFileSync(path.join(tempDir, ".bun-version"), "1.1.0\n");

      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPackageJson).toBe(true);
      expect(env.packageJson?.name).toBe("test-pkg");
      expect(env.nvmRcVersion).toBe("20.10.0");
      expect(env.nodeFileVersion).toBe("22.0.0");
      expect(env.bunFileVersion).toBe("1.1.0");
    });

    it("should detect pnpm-lock.yaml", () => {
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPnpmLock).toBe(true);
      expect(env.hasPackageLock).toBe(false);
      expect(env.hasBunLock).toBe(false);
    });

    it("should detect package-lock.json", () => {
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPackageLock).toBe(true);
      expect(env.hasPnpmLock).toBe(false);
    });

    it("should detect bun.lock and ignore bun.lockb", () => {
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");
      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasBunLock).toBe(true);

      fs.rmSync(path.join(tempDir, "bun.lock"));
      fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
      const env2 = inspectJsProjectEnvironment(tempDir);
      expect(env2.hasBunLock).toBe(false);
    });

    it("should capture JSON parsing errors in packageJsonError and packageJsonErrorCause", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{ invalid json ");
      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPackageJson).toBe(true);
      expect(env.packageJson).toBeUndefined();
      expect(env.packageJsonError).toContain("Failed to parse package.json:");
      expect(env.packageJsonErrorType).toBe("parse");
      expect(env.packageJsonErrorCause).toBeDefined();
    });

    it("should capture read/file access errors in packageJsonError and packageJsonErrorCause", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPackageJson).toBe(true);
      expect(env.packageJson).toBeUndefined();
      expect(env.packageJsonError).toContain(
        "Failed to read package.json: EACCES: permission denied",
      );
      expect(env.packageJsonErrorType).toBe("read");
      expect(env.packageJsonErrorCause).toBeDefined();
    });
  });

  describe("resolveJsPackageManager", () => {
    it("should resolve packageManager field from package.json", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@9.5.0" }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.5.0", source: "packageManager" });
    });

    it("should preserve 'latest' version in packageManager field for pnpm and npm", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@latest" }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "latest", source: "packageManager" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: pnpm@latest");

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "npm@latest" }),
      );
      const projectNpm = inspectJsProjectEnvironment(tempDir);
      const pmNpm = resolveJsPackageManager(projectNpm);
      expect(pmNpm).toEqual({ name: "npm", version: "latest", source: "packageManager" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: npm@latest");
    });

    it("should trim whitespace and normalize uppercase in packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "  PNPM@9.5.0  " }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.5.0", source: "packageManager" });
    });

    it("should resolve packageManager from devEngines if packageManager field is missing", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: "bun@1.2.0" } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "bun", version: "1.2.0", source: "devEngines" });
    });

    it("should trim whitespace and normalize uppercase in devEngines.packageManager", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: [" Yarn@3.0 ", "  PNPM@9.1.0  "] } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.1.0", source: "devEngines" });
    });

    it("should resolve fallback package manager from lockfile when package.json does not specify packageManager", () => {
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION, source: "lockfile" });
    });

    it("should log a core warning when multiple conflicting lockfiles exist in workspace while using deterministic precedence", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);

      expect(pm).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION, source: "lockfile" });
      expect(core.warning).toHaveBeenCalledWith(
        "Multiple conflicting lockfiles found (pnpm-lock.yaml, package-lock.json, bun lockfile). Selecting 'pnpm-lock.yaml' (pnpm) based on priority precedence.",
      );
    });

    it("should parse devEngines runtime declarations without explicit version and return default runtime versions", () => {
      const pkgWithoutVersions = {
        devEngines: {
          runtime: ["NODE", " bun "],
        },
      };
      expect(getDevEngineRuntimeVersion(pkgWithoutVersions, "node")).toBe(DEFAULT_NODE_VERSION);
      expect(getDevEngineRuntimeVersion(pkgWithoutVersions, "bun")).toBe(DEFAULT_BUN_VERSION);

      const pkgObjectsWithoutVersions = {
        devEngines: {
          runtime: [{ name: "NODE" }, { name: "bun" }],
        },
      };
      expect(getDevEngineRuntimeVersion(pkgObjectsWithoutVersions, "node")).toBe(
        DEFAULT_NODE_VERSION,
      );
      expect(getDevEngineRuntimeVersion(pkgObjectsWithoutVersions, "bun")).toBe(
        DEFAULT_BUN_VERSION,
      );
    });

    it("should handle malformed explicit runtime version specifiers by warning and returning undefined instead of defaulting", () => {
      const pkgMalformedStrings = {
        devEngines: {
          runtime: ["node@", "bun:"],
        },
      };
      expect(getDevEngineRuntimeVersion(pkgMalformedStrings, "node")).toBeUndefined();
      expect(getDevEngineRuntimeVersion(pkgMalformedStrings, "bun")).toBeUndefined();
      expect(core.warning).toHaveBeenCalledWith(
        "Malformed node runtime version specifier in package.json devEngines.",
      );
      expect(core.warning).toHaveBeenCalledWith(
        "Malformed bun runtime version specifier in package.json devEngines.",
      );

      const pkgMalformedObjects = {
        devEngines: {
          runtime: [{ name: "node", version: "   " }, { name: "bun", version: "" }],
        },
      };
      expect(getDevEngineRuntimeVersion(pkgMalformedObjects, "node")).toBeUndefined();
      expect(getDevEngineRuntimeVersion(pkgMalformedObjects, "bun")).toBeUndefined();

      const pkgDirectMalformed = {
        devEngines: {
          node: "node@",
          bun: { version: "" },
        },
      };
      expect(getDevEngineRuntimeVersion(pkgDirectMalformed, "node")).toBeUndefined();
      expect(getDevEngineRuntimeVersion(pkgDirectMalformed, "bun")).toBeUndefined();
    });

    it("should ignore unrelated runtime declarations and empty/whitespace values", () => {
      const pkgUnrelated = {
        devEngines: {
          runtime: ["nodedev@1.0.0", "bunyan@2.0.0", "", "   "],
          node: "   ",
        },
      };
      expect(getDevEngineRuntimeVersion(pkgUnrelated, "node")).toBeUndefined();
      expect(getDevEngineRuntimeVersion(pkgUnrelated, "bun")).toBeUndefined();
      expect(getDevEngineRuntimeVersion(undefined, "node")).toBeUndefined();
      expect(getDevEngineRuntimeVersion({}, "node")).toBeUndefined();
    });

    it("should strictly enforce packageManager precedence: packageManager field > devEngines > lockfile", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          packageManager: "npm@11.0.0",
          devEngines: { packageManager: "bun@1.4.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);

      // Should pick explicit packageManager field, not lockfile or devEngines
      expect(pm).toEqual({ name: "npm", version: "11.0.0", source: "packageManager" });
    });

    it("should enforce devEngines.packageManager precedence over lockfiles when packageManager field is absent", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devEngines: { packageManager: "bun@1.4.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);

      // Should pick devEngines.packageManager over lockfile
      expect(pm).toEqual({ name: "bun", version: "1.4.0", source: "devEngines" });
    });

    it("should default to npm if no packageManager or lockfile is found", () => {
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION, source: "default" });
    });

    it("should throw an Error if an unsupported package manager is specified in packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "yarn@3.0.0" }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      expect(() => resolveJsPackageManager(project)).toThrow(Error);
      expect(() => resolveJsPackageManager(project)).toThrow(/Unsupported package manager 'yarn'/);
    });
  });

  describe("getJsInstallationPlan", () => {
    const planCases = [
      { pm: "npm", expected: { packageManager: "npm", command: "npm", args: ["install"] } },
      {
        pm: "pnpm",
        expected: {
          packageManager: "pnpm",
          command: "pnpm",
          args: ["install", "--no-frozen-lockfile"],
        },
      },
      { pm: "bun", expected: { packageManager: "bun", command: "bun", args: ["install"] } },
    ];

    it.each(planCases)("should return expected installation plan for $pm", ({ pm, expected }) => {
      const project = inspectJsProjectEnvironment(tempDir);
      const plan = getJsInstallationPlan(project, pm);
      expect(plan).toEqual(expected);
    });

    it("should throw Error for unsupported package manager", () => {
      const project = inspectJsProjectEnvironment(tempDir);
      expect(() => getJsInstallationPlan(project, "yarn")).toThrow(Error);
      expect(() => getJsInstallationPlan(project, "yarn")).toThrow(
        /Unsupported package manager 'yarn'/,
      );
    });
  });

  describe("selectAutofixScripts", () => {
    it("should prioritize 'check' script over others", () => {
      const scripts = { check: "vp check", format: "prettier -w .", lint: "eslint ." };
      expect(selectAutofixScripts(scripts)).toEqual(["check"]);
    });

    it("should select 'format' and 'lint' when both are defined", () => {
      const scripts = { format: "prettier -w .", lint: "eslint ." };
      expect(selectAutofixScripts(scripts)).toEqual(["format", "lint"]);
    });

    it("should select 'fmt' and 'lint' when 'format' is missing but 'fmt' is defined", () => {
      const scripts = { fmt: "cargo fmt", lint: "eslint ." };
      expect(selectAutofixScripts(scripts)).toEqual(["fmt", "lint"]);
    });

    it("should select single 'format' script when lint is missing", () => {
      const scripts = { format: "prettier -w ." };
      expect(selectAutofixScripts(scripts)).toEqual(["format"]);
    });

    it("should select single 'fmt' script when lint and format are missing", () => {
      const scripts = { fmt: "cargo fmt" };
      expect(selectAutofixScripts(scripts)).toEqual(["fmt"]);
    });

    it("should select single 'lint' script when format/fmt are missing", () => {
      const scripts = { lint: "eslint ." };
      expect(selectAutofixScripts(scripts)).toEqual(["lint"]);
    });

    it("should return empty array when no matching scripts exist", () => {
      expect(selectAutofixScripts({ test: "vitest", build: "tsc" })).toEqual([]);
      expect(selectAutofixScripts(undefined)).toEqual([]);
    });
  });
});
