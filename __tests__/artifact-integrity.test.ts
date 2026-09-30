import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getExpectedArtifacts, verifyArtifactIntegrity } from "../src/artifact-integrity";

describe("Artifact Integrity", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getExpectedArtifacts", () => {
    it("dynamically derives expected artifacts from vite.config.ts", () => {
      const artifacts = getExpectedArtifacts();
      expect(artifacts).toBeDefined();
      expect(artifacts.length).toBeGreaterThanOrEqual(4);

      const names = artifacts.map((a) => a.name);
      expect(names).toContain("resolve-environment");
      expect(names).toContain("lint-format");
      expect(names).toContain("site-variables");
      expect(names).toContain("build-command");

      for (const artifact of artifacts) {
        expect(artifact.sourcePath).toMatch(/^src\//);
        expect(artifact.outputPath).toMatch(/^dist\/.*\.mjs$/);
      }
    });

    it("throws an error if configuration file does not exist", () => {
      expect(() => getExpectedArtifacts(tempDir)).toThrow(/Configuration file not found/);
    });
  });

  describe("verifyArtifactIntegrity", () => {
    it("passes verification for current repository build artifacts", () => {
      const result = verifyArtifactIntegrity();
      expect(result.valid).toBe(true);
      expect(result.missingArtifacts).toEqual([]);
      expect(result.unexpectedArtifacts).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.expectedArtifacts.length).toBeGreaterThanOrEqual(4);
    });

    it("detects missing build artifacts", () => {
      // Mock repository root in tempDir with vite.config.ts and source files, but missing dist files
      const srcDir = path.join(tempDir, "src");
      const distDir = path.join(tempDir, "dist");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });

      // Copy vite.config.ts to tempDir
      fs.copyFileSync(path.join(process.cwd(), "vite.config.ts"), path.join(tempDir, "vite.config.ts"));

      const expected = getExpectedArtifacts(tempDir);
      for (const item of expected) {
        const fullSrc = path.join(tempDir, item.sourcePath);
        fs.mkdirSync(path.dirname(fullSrc), { recursive: true });
        fs.writeFileSync(fullSrc, "export const x = 1;");
      }

      // Create only one of the output files
      const firstArtifact = expected[0];
      fs.writeFileSync(path.join(tempDir, firstArtifact.outputPath), "// built");

      const result = verifyArtifactIntegrity(tempDir);
      expect(result.valid).toBe(false);
      expect(result.missingArtifacts.length).toBe(expected.length - 1);
      expect(result.missingArtifacts).not.toContain(firstArtifact.outputPath);
    });

    it("detects unexpected files in dist/", () => {
      // Copy current repository layout to tempDir
      fs.copyFileSync(path.join(process.cwd(), "vite.config.ts"), path.join(tempDir, "vite.config.ts"));

      const expected = getExpectedArtifacts();
      for (const item of expected) {
        const fullSrc = path.join(tempDir, item.sourcePath);
        const fullDist = path.join(tempDir, item.outputPath);
        fs.mkdirSync(path.dirname(fullSrc), { recursive: true });
        fs.mkdirSync(path.dirname(fullDist), { recursive: true });
        fs.writeFileSync(fullSrc, "export const x = 1;");
        fs.writeFileSync(fullDist, "// build output");
      }

      // Add an unexpected file in dist
      fs.writeFileSync(path.join(tempDir, "dist", "unexpected-artifact.js"), "// dirty");

      const result = verifyArtifactIntegrity(tempDir);
      expect(result.valid).toBe(false);
      expect(result.unexpectedArtifacts).toEqual(["dist/unexpected-artifact.js"]);
    });

    it("detects empty artifact files", () => {
      fs.copyFileSync(path.join(process.cwd(), "vite.config.ts"), path.join(tempDir, "vite.config.ts"));

      const expected = getExpectedArtifacts();
      for (const item of expected) {
        const fullSrc = path.join(tempDir, item.sourcePath);
        const fullDist = path.join(tempDir, item.outputPath);
        fs.mkdirSync(path.dirname(fullSrc), { recursive: true });
        fs.mkdirSync(path.dirname(fullDist), { recursive: true });
        fs.writeFileSync(fullSrc, "export const x = 1;");
        fs.writeFileSync(fullDist, ""); // 0 bytes empty file
      }

      const result = verifyArtifactIntegrity(tempDir);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Generated artifact is empty"))).toBe(true);
    });
  });

  describe("Deterministic Build Verification", () => {
    it("ensures building source produces deterministic artifacts matching dist/", () => {
      // Verify that all dist/ files in git tracking match what npm run build generates
      const statusOutput = execSync("git status --porcelain dist/", { encoding: "utf8" }).trim();
      expect(statusOutput).toBe("");
    });
  });
});
