import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  detectBunVersion,
  detectEnv,
  detectNodeVersion,
  detectPackageManager,
  detectRuntime,
  parseRuntimeInput,
  run,
  setSiteVariables,
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
        specifiedRuntime: "both",
        nodeVersion: "24",
        bunVersion: "1.4",
      });
    });

    it("should parse both keyword", () => {
      const result = parseRuntimeInput("both");
      expect(result).toEqual({
        specifiedRuntime: "both",
      });
    });

    it("should return empty object for empty input", () => {
      expect(parseRuntimeInput("")).toEqual({});
    });
  });

  describe("Fixture-based tests", () => {
    const cases = [
      {
        action: "astro",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "npm",
        type: "minimal",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPm: { name: "npm", version: "latest" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "latest" },
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "bun",
        type: "basic",
        expectedNode: "",
        expectedBun: "latest",
        expectedPm: { name: "bun", version: "latest" },
        expectedRuntime: "bun",
      },
      {
        action: "astro",
        pm: "pnpm-bun",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: ">=1.0.0",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "both",
      },
      {
        action: "astro",
        pm: "bun",
        type: "minimal",
        expectedNode: "",
        expectedBun: "latest",
        expectedPm: { name: "bun", version: "latest" },
        expectedRuntime: "bun",
      },
      {
        action: "lint-format",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "lint-format",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
      {
        action: "vite",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "vite-plus",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "11.21.0" },
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should detect correct environment for fixture $action/$pm/$type",
      ({ action, pm, type, expectedNode, expectedBun, expectedPm, expectedRuntime }) => {
        const fixturePath = path.join(fixturesDir, action, pm, type);
        process.chdir(fixturePath);

        const env = detectEnv();

        expect(env.nodeVersion).toBe(expectedNode);
        expect(env.bunVersion).toBe(expectedBun);
        expect(env.pm).toEqual(expectedPm);
        expect(env.runtime).toBe(expectedRuntime);
      },
    );
  });

  describe("detectEnv unit edge cases", () => {
    it("should respect explicit runtime input node@22", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = detectEnv("node@22");

      expect(env.runtime).toBe("node");
      expect(env.nodeVersion).toBe("22");
      expect(env.bunVersion).toBe("");
    });

    it("should respect explicit runtime input bun@1.4", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = detectEnv("bun@1.4");

      expect(env.runtime).toBe("bun");
      expect(env.nodeVersion).toBe("");
      expect(env.bunVersion).toBe("1.4");
    });

    it("should respect explicit runtime input node@22,bun@1.4", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = detectEnv("node@22,bun@1.4");

      expect(env.runtime).toBe("both");
      expect(env.nodeVersion).toBe("22");
      expect(env.bunVersion).toBe("1.4");
    });
  });

  describe("detectNodeVersion unit edge cases", () => {
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

    it("should return Node.js version from package.json engines if nvmrc and node-version are missing", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ engines: { node: ">=18.0.0" } }) as any,
      );

      expect(detectNodeVersion()).toBe(">=18.0.0");
      expect(core.info).toHaveBeenCalledWith(
        "Found Node.js version in package.json engines: >=18.0.0",
      );
    });

    it("should return empty string and not log recommendation if package manager is bun and no node config exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}) as any);

      expect(detectNodeVersion("bun")).toBe("");
      expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should fall back to lts/* if package.json exists but engines.node is missing for non-bun package manager", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}) as any);

      expect(detectNodeVersion("npm")).toBe("lts/*");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should catch JSON parsing errors or other read errors and warn, then fall back to lts/* for non-bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("SyntaxError: Unexpected token");
      });

      expect(detectNodeVersion("npm")).toBe("lts/*");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: SyntaxError: Unexpected token",
      );
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should catch non-Error exceptions gracefully during detection", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Raw string error";
      });

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: Raw string error",
      );
    });

    it("should fall back to lts/* if no node configuration files exist and pm is not bun", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });
  });

  describe("detectPackageManager unit edge cases", () => {
    it("should detect packageManager without version in package.json and use default 'latest'", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ packageManager: "bun" }) as any);

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: bun@latest");
    });

    it("should detect pnpm from package.json engines if packageManager field is missing", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ engines: { pnpm: ">=8.0.0" } }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: ">=8.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found pnpm in package.json engines: >=8.0.0");
    });

    it("should detect npm from package.json engines", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ engines: { npm: "10.x" } }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "10.x" });
      expect(core.info).toHaveBeenCalledWith("Found npm in package.json engines: 10.x");
    });

    it("should detect bun from package.json engines", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ engines: { bun: ">=1.0.0" } }) as any,
      );

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: ">=1.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found bun in package.json engines: >=1.0.0");
    });

    it("should check fallback lockfiles in order: pnpm-lock.yaml", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "pnpm-lock.yaml");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found pnpm-lock.yaml, using pnpm@latest");
    });

    it("should check fallback lockfiles in order: package-lock.json", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package-lock.json");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found package-lock.json, using npm@latest");
    });

    it("should check fallback lockfiles in order: bun.lock", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found bun lockfile, using bun@latest");
    });

    it("should fallback to default npm@latest if no lockfiles or configuration exists", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@latest");
    });

    it("should handle JSON parser errors or read errors gracefully and use npm fallback", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Broken File System");
      });

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect package manager: Broken File System",
      );
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@latest");
    });

    it("should handle raw exceptions gracefully inside detectPackageManager", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Unexpected raw string error";
      });

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect package manager: Unexpected raw string error",
      );
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@latest");
    });
  });

  describe("detectBunVersion unit edge cases", () => {
    it("should return pm.version when pm.name is bun", () => {
      const pm = { name: "bun", version: "1.1.20" };
      expect(detectBunVersion(pm)).toBe("1.1.20");
    });

    it("should detect engines.bun from package.json if pm.name is not bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ engines: { bun: ">=1.0.0" } }) as any,
      );

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe(">=1.0.0");
    });

    it("should return empty string if pm is not bun and package.json does not specify engines.bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}) as any);

      const pm = { name: "npm", version: "10.0.0" };
      expect(detectBunVersion(pm)).toBe("");
    });
  });

  describe("detectRuntime", () => {
    it("should detect node when only node signals are present", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".nvmrc");
      const runtime = detectRuntime({ name: "npm", version: "latest" }, "");
      expect(runtime).toBe("node");
    });

    it("should detect bun when only bun signals are present", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const runtime = detectRuntime({ name: "bun", version: "latest" }, "latest");
      expect(runtime).toBe("bun");
    });

    it("should detect both when node and bun signals are present", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === ".nvmrc");
      const runtime = detectRuntime({ name: "npm", version: "latest" }, ">=1.0.0");
      expect(runtime).toBe("both");
    });
  });

  describe("setSiteVariables", () => {
    it("should set SITE and BASE variables for a standard repository in the astro action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/project-repo/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith("Set BASE=/project-repo/");
    });

    it("should set SITE and BASE variables for a primary repository in the vite action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/vite";
      process.env.GITHUB_REPOSITORY = "owner/owner.github.io";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith("Set BASE=/");
    });

    it("should set SITE and BASE variables for the vite-plus action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/vite-plus";
      process.env.GITHUB_REPOSITORY = "owner/some-other-project";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/some-other-project/");
    });

    it("should not set SITE and BASE variables for action paths not matching astro/vite/vite-plus", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/lint-format";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should skip setting variables and log warning if GITHUB_REPOSITORY is missing", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      delete process.env.GITHUB_REPOSITORY;

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(
        "GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should skip setting variables and log warning if GITHUB_REPOSITORY_OWNER is missing", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      delete process.env.GITHUB_REPOSITORY_OWNER;

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(
        "GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should handle missing GITHUB_ACTION_PATH by falling back gracefully", () => {
      delete process.env.GITHUB_ACTION_PATH;
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).not.toHaveBeenCalled();
    });
  });

  describe("writeOutput", () => {
    it("should output node-version, bun-version, package manager, and runtime details correctly", () => {
      writeOutput("20.10.0", { name: "pnpm", version: "9.0.0" }, "", "node");

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "9.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
    });
  });

  describe("run", () => {
    it("should coordinate environment detection, set site variables, and write action output on fixture project", () => {
      const fixturePath = path.join(fixturesDir, "astro/npm/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/my-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24.19.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "11.19.0");
      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/my-site/");
    });

    it("should detect bun and omit node recommendation for bun project fixture", () => {
      const fixturePath = path.join(fixturesDir, "astro/bun/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/my-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "latest");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "bun");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "latest");
      expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should detect pnpm package manager and bun engine version for pnpm-bun fixture", () => {
      const fixturePath = path.join(fixturesDir, "astro/pnpm-bun/basic");
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/my-pnpm-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "lts/*");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", ">=1.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "11.21.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "both");
    });
  });
});
