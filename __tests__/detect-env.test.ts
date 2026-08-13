import * as core from "@actions/core";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  detectNodeVersion,
  detectPackageManager,
  run,
  setSiteVariables,
  writeOutput,
} from "../src/detect-env";

vi.mock("node:fs");
vi.mock("@actions/core");

describe("detect-env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe("detectNodeVersion", () => {
    it("should return version from .nvmrc if it exists and trim whitespace", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".nvmrc");
      vi.mocked(fs.readFileSync).mockReturnValue("  20.11.0\n");

      expect(detectNodeVersion()).toBe("20.11.0");
      expect(core.info).toHaveBeenCalledWith("Found .nvmrc: 20.11.0");
    });

    it("should return version from .node-version if .nvmrc does not exist and .node-version exists", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".node-version");
      vi.mocked(fs.readFileSync).mockReturnValue(" 22.0.0 \n");

      expect(detectNodeVersion()).toBe("22.0.0");
      expect(core.info).toHaveBeenCalledWith("Found .node-version: 22.0.0");
    });

    it("should return Node.js version from package.json engines if nvmrc and node-version are missing", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { node: ">=18.0.0" } }));

      expect(detectNodeVersion()).toBe(">=18.0.0");
      expect(core.info).toHaveBeenCalledWith(
        "Found Node.js version in package.json engines: >=18.0.0",
      );
    });

    it("should fall back to lts/* if package.json exists but engines.node is missing", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should catch JSON parsing errors or other read errors and warn, then fall back to lts/*", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("SyntaxError: Unexpected token");
      });

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: SyntaxError: Unexpected token",
      );
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should catch non-Error exceptions gracefully during detection", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw "Raw string error";
      });

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.warning).toHaveBeenCalledWith(
        "Failed to detect Node.js version: Raw string error",
      );
    });

    it("should fall back to lts/* if no node configuration files exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });
  });

  describe("detectPackageManager", () => {
    it("should detect packageManager with version in package.json", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ packageManager: "pnpm@9.12.0" }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "9.12.0" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: pnpm@9.12.0");
    });

    it("should detect packageManager without version in package.json and use default 'latest'", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ packageManager: "yarn" }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "yarn", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: yarn@latest");
    });

    it("should detect pnpm from package.json engines if packageManager field is missing", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { pnpm: ">=8.0.0" } }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: ">=8.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found pnpm in package.json engines: >=8.0.0");
    });

    it("should detect yarn from package.json engines", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { yarn: "^3.0.0" } }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "yarn", version: "^3.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found yarn in package.json engines: ^3.0.0");
    });

    it("should detect npm from package.json engines", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { npm: "10.x" } }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "10.x" });
      expect(core.info).toHaveBeenCalledWith("Found npm in package.json engines: 10.x");
    });

    it("should detect bun from package.json engines", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { bun: ">=1.0.0" } }));

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: ">=1.0.0" });
      expect(core.info).toHaveBeenCalledWith("Found bun in package.json engines: >=1.0.0");
    });

    it("should check fallback lockfiles in order: pnpm-lock.yaml", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "pnpm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found pnpm-lock.yaml, using pnpm@latest");
    });

    it("should check fallback lockfiles in order: yarn.lock", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "yarn.lock");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "yarn", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found yarn.lock, using yarn@latest");
    });

    it("should check fallback lockfiles in order: package-lock.json", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package-lock.json");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found package-lock.json, using npm@latest");
    });

    it("should check fallback lockfiles in order: bun.lock", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "bun.lock");

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "bun", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Found bun.lock, using bun@latest");
    });

    it("should fallback to default npm@latest if no lockfiles or configuration exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const pm = detectPackageManager();
      expect(pm).toEqual({ name: "npm", version: "latest" });
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@latest");
    });

    it("should handle JSON parser errors or read errors gracefully and use npm fallback", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockImplementation(() => {
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
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockImplementation(() => {
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
    it("should output node-version and package manager details correctly", () => {
      writeOutput("20.10.0", { name: "pnpm", version: "9.0.0" });

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "9.0.0");
    });
  });

  describe("run", () => {
    it("should coordinate environment detection, set site variables, and write action output", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".nvmrc");
      vi.mocked(fs.readFileSync).mockReturnValue("18.15.0");

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "owner/my-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "18.15.0");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "latest");
      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/my-site/");
    });
  });
});
