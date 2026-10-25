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
    it("should automatically set SITE, BASE, and BASE_URL variables for a standard repository in the pages action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/project-repo/");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/project-repo/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith(
        "Set BASE=/project-repo/ (also exported as BASE_URL)",
      );
    });

    it("should automatically set SITE, BASE, and BASE_URL variables for a primary repository in the pages action", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/owner.github.io";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/");
      expect(core.info).toHaveBeenCalledWith("Set SITE=https://owner.github.io");
      expect(core.info).toHaveBeenCalledWith("Set BASE=/ (also exported as BASE_URL)");
    });

    it("should handle case-insensitive owner matching between GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "OwnerName/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "ownername";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://ownername.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/project-repo/");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/project-repo/");
    });

    it("should not set site variables for action paths not matching pages", () => {
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

    it("should skip setting variables and log warning if GITHUB_REPOSITORY format is malformed", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "invalid-no-slash";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(
        "Invalid GITHUB_REPOSITORY format 'invalid-no-slash'. Expected 'owner/repo'. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();

      process.env.GITHUB_REPOSITORY = "a/b/c";
      setSiteVariables();
      expect(core.warning).toHaveBeenCalledWith(
        "Invalid GITHUB_REPOSITORY format 'a/b/c'. Expected 'owner/repo'. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();

      process.env.GITHUB_REPOSITORY = "owner/";
      setSiteVariables();
      expect(core.warning).toHaveBeenCalledWith(
        "Invalid GITHUB_REPOSITORY format 'owner/'. Expected 'owner/repo'. Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should skip setting variables and log warning if GITHUB_REPOSITORY owner conflicts with GITHUB_REPOSITORY_OWNER", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "ownerA/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "ownerB";

      setSiteVariables();

      expect(core.warning).toHaveBeenCalledWith(
        "Inconsistent repository owner metadata: GITHUB_REPOSITORY owner ('ownerA') does not match GITHUB_REPOSITORY_OWNER ('ownerB'). Skipping site variables.",
      );
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("should fall back to ACTION_PATH when GITHUB_ACTION_PATH is missing", () => {
      delete process.env.GITHUB_ACTION_PATH;
      process.env.ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://owner.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/project-repo/");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/project-repo/");
    });

    it("should handle missing GITHUB_ACTION_PATH and ACTION_PATH by falling back gracefully", () => {
      delete process.env.GITHUB_ACTION_PATH;
      delete process.env.ACTION_PATH;
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      setSiteVariables();

      expect(core.exportVariable).not.toHaveBeenCalled();
    });
  });

  describe("resolveSiteVariables", () => {
    it("should return null if repository owner or name is missing", () => {
      expect(resolveSiteVariables({})).toBeNull();
      expect(resolveSiteVariables({ GITHUB_REPOSITORY: "owner/repo" })).toBeNull();
      expect(resolveSiteVariables({ GITHUB_REPOSITORY_OWNER: "owner" })).toBeNull();
    });

    it("should return null for malformed GITHUB_REPOSITORY string", () => {
      expect(
        resolveSiteVariables({
          GITHUB_REPOSITORY: "malformed",
          GITHUB_REPOSITORY_OWNER: "owner",
        }),
      ).toBeNull();

      expect(
        resolveSiteVariables({
          GITHUB_REPOSITORY: "a/b/c",
          GITHUB_REPOSITORY_OWNER: "a",
        }),
      ).toBeNull();

      expect(
        resolveSiteVariables({
          GITHUB_REPOSITORY: "owner/",
          GITHUB_REPOSITORY_OWNER: "owner",
        }),
      ).toBeNull();

      expect(
        resolveSiteVariables({
          GITHUB_REPOSITORY: "/repo",
          GITHUB_REPOSITORY_OWNER: "owner",
        }),
      ).toBeNull();
    });

    it("should return null if GITHUB_REPOSITORY owner conflicts with GITHUB_REPOSITORY_OWNER", () => {
      expect(
        resolveSiteVariables({
          GITHUB_REPOSITORY: "ownerA/repo",
          GITHUB_REPOSITORY_OWNER: "ownerB",
        }),
      ).toBeNull();
    });

    it("should automatically resolve site and base for standard repo", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_OWNER: "owner",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/repo/",
      });
    });

    it("should automatically resolve site and base for primary repo", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/owner.github.io",
        GITHUB_REPOSITORY_OWNER: "owner",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/",
      });
    });

    it("should automatically resolve site and base for primary repo case-insensitively", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "Owner/OWNER.github.io",
        GITHUB_REPOSITORY_OWNER: "owner",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/",
      });
    });
  });
});
