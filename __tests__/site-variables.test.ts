import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveSiteVariables,
  setSiteVariables,
  validateAndNormalizeBasePath,
} from "../src/pages/site-variables";

vi.mock("@actions/core");

describe("site-variables", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SITE;
    delete process.env.BASE;
    delete process.env.BASE_URL;
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
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/custom-base/");
    });

    it("should report failure when explicit SITE URL contains path components", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      process.env.SITE = "https://customdomain.com/subpath";

      setSiteVariables();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve site variables: Invalid SITE URL: path components are not supported for SITE origin.",
      );
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

    it("should report failure when explicit SITE URL includes query parameters or fragments", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/project-repo";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";
      process.env.SITE = "https://customdomain.com?param=value";

      setSiteVariables();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve site variables: Invalid SITE URL: query strings and fragments are not supported.",
      );
    });
  });

  describe("validateAndNormalizeBasePath", () => {
    it("should return empty string for missing or whitespace-only input", () => {
      expect(validateAndNormalizeBasePath("")).toBe("");
      expect(validateAndNormalizeBasePath("   ")).toBe("");
    });

    it("should normalize path prefixes with leading/trailing slashes and collapse duplicate slashes", () => {
      expect(validateAndNormalizeBasePath("docs")).toBe("/docs/");
      expect(validateAndNormalizeBasePath("/docs")).toBe("/docs/");
      expect(validateAndNormalizeBasePath("docs/")).toBe("/docs/");
      expect(validateAndNormalizeBasePath("///docs///subpath///")).toBe("/docs/subpath/");
      expect(validateAndNormalizeBasePath("/")).toBe("/");
    });

    it("should reject absolute URLs as base paths", () => {
      expect(() => validateAndNormalizeBasePath("https://example.com")).toThrow(
        "Invalid base/base_url: absolute URLs are not supported.",
      );
      expect(() => validateAndNormalizeBasePath("http://example.com/subpath")).toThrow(
        "Invalid base/base_url: absolute URLs are not supported.",
      );
      expect(() => validateAndNormalizeBasePath("//example.com/subpath")).toThrow(
        "Invalid base/base_url: absolute URLs are not supported.",
      );
    });

    it("should reject query strings, fragments, control characters, backslashes, or dot segments in base paths", () => {
      expect(() => validateAndNormalizeBasePath("/path?foo=bar")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
      );
      expect(() => validateAndNormalizeBasePath("/path#hash")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
      );
      expect(() => validateAndNormalizeBasePath("/path\x00bad")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
      );
      expect(() => validateAndNormalizeBasePath("C:\\path\\sub")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
      );
      expect(() => validateAndNormalizeBasePath("/docs/../secret")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
      );
      expect(() => validateAndNormalizeBasePath("/./docs")).toThrow(
        "Invalid base/base_url: expected a valid path prefix.",
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

    it("should support BASE_URL independently when BASE is not set", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_OWNER: "owner",
        BASE_URL: "my-app",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/my-app/",
      });
    });

    it("should accept matching BASE and BASE_URL configurations", () => {
      const result = resolveSiteVariables({
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REPOSITORY_OWNER: "owner",
        BASE: "my-app",
        BASE_URL: "/my-app/",
      });

      expect(result).toEqual({
        site: "https://owner.github.io",
        base: "/my-app/",
      });
    });

    it("should throw error when BASE and BASE_URL conflict", () => {
      expect(() =>
        resolveSiteVariables({
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_REPOSITORY_OWNER: "owner",
          BASE: "docs",
          BASE_URL: "app",
        }),
      ).toThrow("Conflicting base/base_url configuration: BASE and BASE_URL specify different paths.");
    });
  });
});
