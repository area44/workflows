import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveSiteVariables, setSiteVariables } from "../src/pages/site-variables";

vi.mock("@actions/core");

describe("site-variables", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("setSiteVariables", () => {
    it("should set SITE and BASE variables for a standard repository in the pages action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/project-repo/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith("Set BASE=/project-repo/");
    });

    it("should set SITE and BASE variables for a primary repository in the pages action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/owner.github.io";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith("Set BASE=/");
    });

    it("should not set SITE and BASE variables for action paths not matching pages", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/autofix";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should skip setting variables and log warning if GITHUB_REPOSITORY is missing", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      delete process.env.GITHUB_REPOSITORY;

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(
        "GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should skip setting variables and log warning if GITHUB_REPOSITORY_OWNER is missing", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
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

    it("should respect explicit SITE and BASE environment overrides and normalize them", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      process.env.SITE = "https://customdomain.com/";
      process.env.BASE = "custom-base";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://customdomain.com");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/custom-base/");
    });

    it("should report failure when explicit SITE URL is malformed", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      process.env.SITE = "invalid-site-url";

      setSiteVariables();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve site variables: Invalid SITE URL 'invalid-site-url': must be a valid http or https URL.",
      );
    });

    it("should report failure when explicit SITE URL uses unsupported scheme", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      process.env.SITE = "ftp://customdomain.com";

      setSiteVariables();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve site variables: Invalid SITE URL scheme 'ftp:'. Expected 'http:' or 'https:'.",
      );
    });
  });

  describe("resolveSiteVariables", () => {
    it("should return null if repository owner or name is missing", () => {
      expect(resolveSiteVariables({})).toBeNull();
      expect(resolveSiteVariables({ GITHUB_REPOSITORY: "owner/repo" })).toBeNull();
      expect(resolveSiteVariables({ GITHUB_REPOSITORY_OWNER: "owner" })).toBeNull();
    });

    it("should normalize BASE with leading/trailing slashes and collapse duplicate slashes", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_OWNER: "owner",
        BASE: "///subpath///dir///",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/subpath/dir/",
      });
    });

    it("should preserve single slash BASE", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_OWNER: "owner",
        BASE: "/",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/",
      });
    });
  });
});
