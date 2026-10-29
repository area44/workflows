import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as core from "@actions/core";
import {
  hasDevEngineRuntime,
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  isSupportedPackageManager,
  isSupportedRuntime,
  resolveJsEnvironment,
  resolveJsPackageManager,
  resolveRuntime,
  resolveToolchain,
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

      const res = resolveJsEnvironment("auto", tempDir);
      expect(res.detected).toBe(true);
      expect(res.packageManager).toEqual({ name: "pnpm" });
      expect(res.runtime).toEqual({ name: "node" });
      expect(res.toolchain).toBeUndefined();
    });

    it("should suppress JS detection logs when package.json is absent", () => {
      const res = resolveJsEnvironment("auto", tempDir);
      expect(res.detected).toBe(false);
      expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining("Package manager not specified"),
      );
    });

    it("should suppress JS warnings and logs in Python-only project", () => {
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')");

      const res = resolveJsEnvironment("auto", tempDir);
      expect(res.detected).toBe(false);
      expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
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

  describe("resolveToolchain", () => {
    it("should resolve toolchain correctly and reject unsupported toolchain inputs", () => {
      expect(resolveToolchain("vite-plus")).toBe("vite-plus");
      expect(resolveToolchain("auto")).toBeUndefined();
      expect(() => resolveToolchain("vite")).toThrow(
        'Invalid toolchain input: unsupported value. Supported values are "auto" or "vite-plus".',
      );

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
        'Invalid toolchain input: unsupported value. Supported values are "auto" or "vite-plus".',
      );
    });
  });

  describe("resolveRuntime", () => {
    it("should fail when packageManager indicates Bun and both devEngines.node and devEngines.bun are declared", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { node: "22.0.0", bun: "1.4.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      expect(() => resolveRuntime({ name: "bun" }, project)).toThrow(
        "Conflicting runtime configuration in package.json devEngines: both Node.js and Bun runtimes are specified.",
      );
    });

    it("should fail when packageManager indicates Bun but Node.js runtime is explicitly declared in devEngines", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { node: "22.0.0" } },
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      expect(() => resolveRuntime({ name: "bun" }, project)).toThrow(
        "Conflicting runtime configuration: packageManager indicates Bun but package.json devEngines specifies Node.js runtime.",
      );
    });

    it("should fail when both devEngines.node and devEngines.bun are declared", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { node: "22.0.0", bun: "1.4.0" } },
        hasPnpmLock: false,
        hasPackageLock: true,
        hasBunLock: false,
      };
      expect(() => resolveRuntime({ name: "npm" }, project)).toThrow(
        "Conflicting runtime configuration in package.json devEngines: both Node.js and Bun runtimes are specified.",
      );
    });

    it("should resolve Bun when only devEngines.bun is declared", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { bun: "1.4.0" } },
        hasPnpmLock: true,
        hasPackageLock: false,
        hasBunLock: false,
      };
      expect(resolveRuntime({ name: "pnpm" }, project)).toBe("bun");
    });

    it("should resolve Node.js when only devEngines.node is declared", () => {
      const project = {
        hasPackageJson: true,
        packageJson: { devEngines: { node: "22.0.0" } },
        hasPnpmLock: false,
        hasPackageLock: true,
        hasBunLock: false,
      };
      expect(resolveRuntime({ name: "npm" }, project)).toBe("node");
    });

    it("should infer Bun when packageManager is Bun with no conflicting declarations", () => {
      const project = {
        hasPackageJson: true,
        hasPnpmLock: false,
        hasPackageLock: false,
        hasBunLock: true,
      };
      expect(resolveRuntime({ name: "bun" }, project)).toBe("bun");
    });

    it("should resolve default node runtime when no explicit runtime declaration is present", () => {
      const project = {
        hasPackageJson: true,
        hasPnpmLock: false,
        hasPackageLock: true,
        hasBunLock: false,
      };
      expect(resolveRuntime({ name: "npm" }, project)).toBe("node");
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
    it("should detect package.json and lockfiles", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

      const env = inspectJsProjectEnvironment(tempDir);
      expect(env.hasPackageJson).toBe(true);
      expect(env.packageJson?.name).toBe("test-pkg");
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
      expect(pm).toEqual({ name: "pnpm", source: "packageManager" });
    });

    it("should preserve name in packageManager field for pnpm and npm", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@latest" }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", source: "packageManager" });

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "npm@latest" }),
      );
      const projectNpm = inspectJsProjectEnvironment(tempDir);
      const pmNpm = resolveJsPackageManager(projectNpm);
      expect(pmNpm).toEqual({ name: "npm", source: "packageManager" });
    });

    it("should trim whitespace and normalize uppercase in packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "  PNPM@9.5.0  " }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", source: "packageManager" });
    });

    it("should resolve packageManager from devEngines if packageManager field is missing", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: "bun@1.2.0" } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "bun", source: "devEngines" });
    });

    it("should trim whitespace and normalize uppercase in devEngines.packageManager", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: [" Yarn@3.0 ", "  PNPM@9.1.0  "] } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", source: "devEngines" });
    });

    it("should resolve fallback package manager from lockfile when package.json does not specify packageManager", () => {
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", source: "lockfile" });
    });

    it("should log a core warning when multiple conflicting lockfiles exist in workspace while using deterministic precedence", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);

      expect(pm).toEqual({ name: "pnpm", source: "lockfile" });
      expect(core.warning).toHaveBeenCalledWith(
        "Multiple conflicting lockfiles found (pnpm-lock.yaml, package-lock.json, bun lockfile). Selecting 'pnpm-lock.yaml' (pnpm) based on priority precedence.",
      );
    });

    it("should detect devEngines runtime declarations", () => {
      const pkgWithoutVersions = {
        devEngines: {
          runtime: ["NODE", " bun "],
        },
      };
      expect(hasDevEngineRuntime(pkgWithoutVersions, "node")).toBe(true);
      expect(hasDevEngineRuntime(pkgWithoutVersions, "bun")).toBe(true);

      const pkgObjectsWithoutVersions = {
        devEngines: {
          runtime: [{ name: "NODE" }, { name: "bun" }],
        },
      };
      expect(hasDevEngineRuntime(pkgObjectsWithoutVersions, "node")).toBe(true);
      expect(hasDevEngineRuntime(pkgObjectsWithoutVersions, "bun")).toBe(true);
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
      expect(pm).toEqual({ name: "npm", source: "packageManager" });
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
      expect(pm).toEqual({ name: "bun", source: "devEngines" });
    });

    it("should default to npm if no packageManager or lockfile is found", () => {
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "npm", source: "default" });
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
