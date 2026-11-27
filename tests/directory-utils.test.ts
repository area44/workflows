import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  collectParentDirs,
  globToRegex,
  isDirectoryMatchedByGlobs,
} from "@/python-env/directory-utils";

describe("globToRegex - Windows path separator normalization", () => {
  it("normalizes backslashes to forward slashes in glob patterns", () => {
    const regex = globToRegex("packages\\*\\src");
    expect(regex).toBeInstanceOf(RegExp);
    // The glob normalizes \\ to /, producing packages/*/src → ^packages/[^/]*/src$
    expect(regex.test("packages/foo/src")).toBe(true);
    expect(regex.test("packages/bar/src")).toBe(true);
    expect(regex.test("packages/foo/bar/src")).toBe(false);
  });

  it("normalizes leading .\\ sequences", () => {
    const regex = globToRegex("./packages/*");
    expect(regex.test("packages/foo")).toBe(true);
    expect(regex.test("packages/bar")).toBe(true);
  });

  it("normalizes trailing slashes", () => {
    const regex = globToRegex("packages/");
    // packages/ → packages → ^packages$
    expect(regex.test("packages")).toBe(true);
    expect(regex.test("packages/")).toBe(false);
  });

  it("handles Windows drive-letter style paths gracefully", () => {
    const regex = globToRegex("C:\\projects\\*");
    expect(regex.test("C:/projects/foo")).toBe(true);
    expect(regex.test("C:/projects/bar")).toBe(true);
  });

  it("converts **/ to (?:.*/)?", () => {
    const regex = globToRegex("**/*.py");
    expect(regex.test("src/main.py")).toBe(true);
    expect(regex.test("a/b/c/main.py")).toBe(true);
    expect(regex.test("main.py")).toBe(true);
  });

  it("converts * to [^/]* within a segment", () => {
    const regex = globToRegex("*.py");
    expect(regex.test("main.py")).toBe(true);
    expect(regex.test("dir/main.py")).toBe(false);
  });

  it("converts ? to [^/]", () => {
    const regex = globToRegex("file?.py");
    expect(regex.test("file1.py")).toBe(true);
    expect(regex.test("fileX.py")).toBe(true);
    expect(regex.test("file12.py")).toBe(false);
  });

  it("escapes regex special characters", () => {
    const regex = globToRegex("file+name.py");
    expect(regex.test("file+name.py")).toBe(true);
    expect(regex.test("fileXname.py")).toBe(false);
  });

  it("escapes dots in filenames", () => {
    const regex = globToRegex("config.toml");
    expect(regex.test("config.toml")).toBe(true);
    expect(regex.test("configXtoml")).toBe(false);
  });

  it("returns empty match pattern for . or empty string", () => {
    expect(globToRegex(".").test("")).toBe(true);
    expect(globToRegex("").test("")).toBe(true);
  });
});

describe("isDirectoryMatchedByGlobs - Windows path normalization", () => {
  it("normalizes Windows backslash paths before matching", () => {
    // "packages\\foo\\bar" normalizes to "packages/foo/bar"
    expect(isDirectoryMatchedByGlobs("packages\\foo\\bar", ["packages/foo/*"])).toBe(true);
    expect(isDirectoryMatchedByGlobs("packages\\foo\\bar", ["packages/*"])).toBe(false);
  });

  it("normalizes leading .\\ sequences", () => {
    expect(isDirectoryMatchedByGlobs(".\\packages\\foo", ["./packages/*"])).toBe(true);
  });

  it("normalizes trailing backslashes", () => {
    // "packages\\" normalizes to "packages" → matches glob "packages"
    expect(isDirectoryMatchedByGlobs("packages\\", ["packages"])).toBe(true);
    expect(isDirectoryMatchedByGlobs("packages\\foo\\", ["packages/foo"])).toBe(true);
  });

  it("returns false when no glob matches", () => {
    expect(isDirectoryMatchedByGlobs("packages\\foo", ["src/*"])).toBe(false);
  });

  it("returns true when any glob matches", () => {
    expect(isDirectoryMatchedByGlobs("packages\\foo", ["src/*", "packages/*"])).toBe(true);
  });
});

describe("collectParentDirs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-parent-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns the starting directory as the first entry", () => {
    const dirs = collectParentDirs(tempDir);
    expect(dirs[0]).toBe(tempDir);
  });

  it("stops traversal at the filesystem root", () => {
    const dirs = collectParentDirs(tempDir);
    const root = path.parse(tempDir).root;
    expect(dirs[dirs.length - 1]).toBe(root);
  });

  it("stops traversal when a .git directory is encountered", () => {
    const nested = path.join(tempDir, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".git"), "");

    const dirs = collectParentDirs(nested);
    expect(dirs.includes(tempDir)).toBe(true);
    // Should stop at tempDir (has .git), not continue past it
    const tempDirIndex = dirs.indexOf(tempDir);
    const entriesAfterGit = dirs.slice(tempDirIndex + 1);
    // Root may or may not be included depending on path structure, but nothing between tempDir and root with .git
    expect(entriesAfterGit.length).toBeLessThanOrEqual(1);
  });

  it("does not stop early when no .git directory exists", () => {
    const nested = path.join(tempDir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    const dirs = collectParentDirs(nested);
    const root = path.parse(tempDir).root;
    expect(dirs.includes(tempDir)).toBe(true);
    expect(dirs.includes(root)).toBe(true);
  });
});
