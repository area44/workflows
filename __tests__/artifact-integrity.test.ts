import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getExpectedArtifacts,
  parseViteConfigPack,
  verifyArtifactIntegrity,
} from "../src/artifact-integrity";

describe("Artifact Integrity Verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("parseViteConfigPack & getExpectedArtifacts", () => {
    it("dynamically derives expected artifacts from repository vite.config.ts", () => {
      const artifacts = getExpectedArtifacts();
      expect(artifacts).toBeDefined();
      expect(artifacts.length).toBeGreaterThanOrEqual(4);

      const names = artifacts.map((a) => a.name);
      expect(names).toContain("resolve-environment");
      expect(names).toContain("lint-format");
      expect(names).toContain("site-variables");
      expect(names).toContain("build-command");

      for (const artifact of artifacts) {
        expect(artifact.sourcePath).toMatch(/^src[/\\]/);
        expect(artifact.outputPath).toMatch(/^dist[/\\].*\.mjs$/);
      }
    });

    it("parses static pack array configuration format", () => {
      const staticConfig = `
        export default defineConfig({
          pack: [
            { entry: { "custom-action": "src/custom-action.ts" }, outDir: "build-out", format: "cjs" }
          ]
        });
      `;
      const result = parseViteConfigPack(staticConfig);
      expect(result).toEqual([
        {
          name: "custom-action",
          sourcePath: path.normalize("src/custom-action.ts"),
          outputPath: path.normalize("build-out/custom-action.cjs"),
        },
      ]);
    });

    it("throws an error if configuration file does not exist", () => {
      expect(() => getExpectedArtifacts(tempDir)).toThrow(/Configuration file not found/);
    });

    it("respects custom rootDir independently without relying on process.cwd() config", () => {
      const customConfig = `
        export default defineConfig({
          pack: ["isolated-tool"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "out",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);

      const artifacts = getExpectedArtifacts(tempDir);
      expect(artifacts).toEqual([
        {
          name: "isolated-tool",
          sourcePath: path.normalize("src/isolated-tool.ts"),
          outputPath: path.normalize("out/isolated-tool.mjs"),
        },
      ]);
    });
  });

  describe("verifyArtifactIntegrity", () => {
    it("1. passes verification when all expected artifacts exist and dist/ is synchronized", () => {
      const result = verifyArtifactIntegrity();
      expect(result.valid).toBe(true);
      expect(result.missingArtifacts).toEqual([]);
      expect(result.unexpectedArtifacts).toEqual([]);
      expect(result.staleArtifacts).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.expectedArtifacts.length).toBeGreaterThanOrEqual(4);
    });

    it("2. detects missing artifacts", () => {
      const customConfig = `
        export default defineConfig({
          pack: ["tool1", "tool2"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tempDir, "src/tool2.ts"), "export const b = 2;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// built tool1");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: false, executeBuild: false });
      expect(result.valid).toBe(false);
      expect(result.missingArtifacts).toEqual([path.normalize("dist/tool2.mjs")]);
    });

    it("3. detects empty artifact files", () => {
      const customConfig = `
        export default defineConfig({
          pack: ["empty-tool"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/empty-tool.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/empty-tool.mjs"), "");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: false, executeBuild: false });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Generated artifact is empty"))).toBe(true);
    });

    it("4. detects unexpected files in dist/", () => {
      const customConfig = `
        export default defineConfig({
          pack: ["tool1"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// built");
      fs.writeFileSync(path.join(tempDir, "dist/unexpected-file.js"), "// un-tracked artifact");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: false, executeBuild: false });
      expect(result.valid).toBe(false);
      expect(result.unexpectedArtifacts).toEqual([path.normalize("dist/unexpected-file.js")]);
    });

    it("5. detects modified/stale artifacts via working tree status", () => {
      execSync("git init", { cwd: tempDir, stdio: "ignore" });
      execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });
      execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });

      const customConfig = `
        export default defineConfig({
          pack: ["tool1"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 built artifact");

      execSync("git add . && git commit -m 'initial'", { cwd: tempDir, stdio: "ignore" });

      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v2 manually edited artifact");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: true, executeBuild: false });
      expect(result.valid).toBe(false);
      expect(result.staleArtifacts).toEqual([path.normalize("dist/tool1.mjs")]);
    });

    it("6. works on custom rootDir with isolated config, src, and dist directories", () => {
      const customConfig = `
        export default defineConfig({
          pack: ["isolated-action"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/isolated-action.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/isolated-action.mjs"), "// built content");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: false, executeBuild: false });
      expect(result.valid).toBe(true);
      expect(result.expectedArtifacts).toEqual([
        {
          name: "isolated-action",
          sourcePath: path.normalize("src/isolated-action.ts"),
          outputPath: path.normalize("dist/isolated-action.mjs"),
        },
      ]);
    });

    it("7. fails verification when source code is updated without rebuilding dist/", () => {
      execSync("git init", { cwd: tempDir, stdio: "ignore" });
      execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });
      execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });

      const customConfig = `
        export default defineConfig({
          pack: ["tool1"].map((name) => ({
            entry: { [name]: \`src/\${name}.ts\` },
            outDir: "dist",
            format: "esm",
          })),
        });
      `;
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), customConfig);
      fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 output");

      execSync("git add . && git commit -m 'initial'", { cwd: tempDir, stdio: "ignore" });

      // Update source file in tempDir without regenerating dist/tool1.mjs
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const a = 2; // updated source");
      // Simulate build regenerating dist/
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v2 output regenerated");

      const result = verifyArtifactIntegrity(tempDir, { checkGitStatus: true, executeBuild: false });
      expect(result.valid).toBe(false);
      expect(result.staleArtifacts).toEqual([path.normalize("dist/tool1.mjs")]);
    });
  });
});
