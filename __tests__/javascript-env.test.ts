import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  selectAutofixScripts,
} from "../src/javascript-env";

describe("javascript-env", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = path.join(originalCwd, "__tests__/fixtures/temp-js-env-" + Math.random().toString(36).substring(2, 9));
    fs.mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
      expect(env.packageJsonError).toContain("Failed to read package.json: EACCES: permission denied");
      expect(env.packageJsonErrorType).toBe("read");
      expect(env.packageJsonErrorCause).toBeDefined();
    });
  });

  describe("resolveJsPackageManager", () => {
    it("should resolve packageManager field from package.json", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.5.0" }));
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.5.0" });
    });

    it("should trim whitespace and normalize uppercase in packageManager field", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ packageManager: "  PNPM@9.5.0  " }));
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.5.0" });
    });

    it("should resolve packageManager from devEngines if packageManager field is missing", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: "bun@1.2.0" } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "bun", version: "1.2.0" });
    });

    it("should trim whitespace and normalize uppercase in devEngines.packageManager", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devEngines: { packageManager: [" Yarn@3.0 ", "  PNPM@9.1.0  "] } }),
      );
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: "9.1.0" });
    });

    it("should resolve fallback package manager from lockfile when package.json does not specify packageManager", () => {
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "pnpm", version: DEFAULT_PNPM_VERSION });
    });

    it("should default to npm if no packageManager or lockfile is found", () => {
      const project = inspectJsProjectEnvironment(tempDir);
      const pm = resolveJsPackageManager(project);
      expect(pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
    });

    it("should throw an Error if an unsupported package manager is specified in packageManager field", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ packageManager: "yarn@3.0.0" }));
      const project = inspectJsProjectEnvironment(tempDir);
      expect(() => resolveJsPackageManager(project)).toThrow(Error);
      expect(() => resolveJsPackageManager(project)).toThrow(/Unsupported package manager 'yarn'/);
    });
  });

  describe("getJsInstallationPlan", () => {
    const planCases = [
      { pm: "npm", expected: { packageManager: "npm", command: "npm", args: ["install"] } },
      { pm: "pnpm", expected: { packageManager: "pnpm", command: "pnpm", args: ["install", "--no-frozen-lockfile"] } },
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
      expect(() => getJsInstallationPlan(project, "yarn")).toThrow(/Unsupported package manager 'yarn'/);
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
