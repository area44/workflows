import * as core from "@actions/core";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  detectNodeVersion,
  detectPackageManager,
  shouldSetSiteVariables,
  setSiteVariables,
} from "../src/detect-env";

vi.mock("node:fs");
vi.mock("@actions/core");

describe("detect-env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe("detectNodeVersion", () => {
    it("should return version from .nvmrc if it exists", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".nvmrc");
      vi.mocked(fs.readFileSync).mockReturnValue("20");

      expect(detectNodeVersion()).toBe("20");
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Found .nvmrc: 20"));
    });

    it("should return version from .node-version if it exists and .nvmrc does not", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".node-version");
      vi.mocked(fs.readFileSync).mockReturnValue("22");

      expect(detectNodeVersion()).toBe("22");
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Found .node-version: 22"));
    });

    it("should return version from package.json engines if .nvmrc and .node-version do not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { node: ">=18" } }));

      expect(detectNodeVersion()).toBe(">=18");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Found Node.js version in package.json engines: >=18"),
      );
    });

    it("should return lts/* if no version is found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(detectNodeVersion()).toBe("lts/*");
      expect(core.info).toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });
  });

  describe("detectPackageManager", () => {
    it("should detect pnpm-lock.yaml", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");
      expect(detectPackageManager().name).toBe("pnpm");
      expect(core.info).toHaveBeenCalledWith("Found pnpm-lock.yaml, using pnpm@latest");
    });

    it("should detect yarn.lock", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "yarn.lock");
      expect(detectPackageManager().name).toBe("yarn");
      expect(core.info).toHaveBeenCalledWith("Found yarn.lock, using yarn@latest");
    });

    it("should detect package-lock.json", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package-lock.json");
      expect(detectPackageManager().name).toBe("npm");
      expect(core.info).toHaveBeenCalledWith("Found package-lock.json, using npm@latest");
    });

    it("should detect bun.lock", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "bun.lock");
      expect(detectPackageManager().name).toBe("bun");
      expect(core.info).toHaveBeenCalledWith("Found bun.lock, using bun@latest");
    });

    it("should detect packageManager in package.json", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ packageManager: "pnpm@9.0.0" }));

      const pm = detectPackageManager();
      expect(pm.name).toBe("pnpm");
      expect(pm.version).toBe("9.0.0");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Found packageManager in package.json: pnpm@9.0.0"),
      );
    });

    it("should detect package manager in package.json engines", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "package.json");
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ engines: { pnpm: ">=9.0.0" } }));

      const pm = detectPackageManager();
      expect(pm.name).toBe("pnpm");
      expect(pm.version).toBe(">=9.0.0");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Found pnpm in package.json engines: >=9.0.0"),
      );
    });

    it("should return default npm if no lockfile or packageManager is found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const pm = detectPackageManager();
      expect(pm.name).toBe("npm");
      expect(pm.version).toBe("latest");
      expect(core.info).toHaveBeenCalledWith("Package manager not specified, using npm@latest");
    });
  });

  describe("shouldSetSiteVariables", () => {
    it("should return true for astro action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      expect(shouldSetSiteVariables()).toBe(true);
    });

    it("should return true for vite action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/vite";
      expect(shouldSetSiteVariables()).toBe(true);
    });

    it("should return true for vite-plus action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/vite-plus";
      expect(shouldSetSiteVariables()).toBe(true);
    });

    it("should return false for other actions", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/lint-format";
      expect(shouldSetSiteVariables()).toBe(false);
    });

    it("should return false if GITHUB_ACTION_PATH is not set", () => {
      delete process.env.GITHUB_ACTION_PATH;
      expect(shouldSetSiteVariables()).toBe(false);
    });
  });

  describe("setSiteVariables", () => {
    it("should set variables correctly for project site", () => {
      process.env.GITHUB_REPOSITORY = "user/repo";
      process.env.GITHUB_REPOSITORY_OWNER = "user";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://user.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith(
        "VITE_SITE_URL",
        "https://user.github.io/repo",
      );
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/repo/");
    });

    it("should set variables correctly for user site", () => {
      process.env.GITHUB_REPOSITORY = "user/user.github.io";
      process.env.GITHUB_REPOSITORY_OWNER = "user";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://user.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("VITE_SITE_URL", "https://user.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/");
    });

    it("should skip if repo or owner is missing", () => {
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_REPOSITORY_OWNER;

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("not set"));
      expect(core.exportVariable).not.toHaveBeenCalled();
    });
  });
});
