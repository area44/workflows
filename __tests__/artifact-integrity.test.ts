import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  getExpectedArtifacts,
  parseViteConfigPack,
  runArtifactVerification,
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

    it("Case G — custom rootDir operates independently without relying on process.cwd()", () => {
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
    it("Case A — valid: passes verification when source and dist/ are synchronized", () => {
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

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 bundle output");
      execSync("git add . && git commit -m 'initial v1'", { cwd: tempDir, stdio: "ignore" });

      const mockBuildFn = () => {
        fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 bundle output");
      };

      const result = verifyArtifactIntegrity(tempDir, {
        executeBuild: true,
        buildFn: mockBuildFn,
        checkGitStatus: true,
      });

      expect(result.valid).toBe(true);
      expect(result.buildFailed).toBe(false);
      expect(result.missingArtifacts).toEqual([]);
      expect(result.unexpectedArtifacts).toEqual([]);
      expect(result.staleArtifacts).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("passes verification on current repository when git status check is disabled during local development", () => {
      const result = verifyArtifactIntegrity(process.cwd(), { executeBuild: false, checkGitStatus: false });
      expect(result.valid).toBe(true);
      expect(result.expectedArtifacts.length).toBeGreaterThanOrEqual(4);
    });

    it("Case B — missing artifact: fails when expected dist file does not exist", () => {
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

    it("Case C — empty artifact: fails when dist file is 0 bytes", () => {
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

    it("Case D — unexpected artifact: fails when untracked extra file exists in dist/", () => {
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

    it("Case E — stale artifact: fails when source is updated to v2 but committed dist/ is still v1", () => {
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

      // Initial state: source v1, dist v1
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 bundle output");
      execSync("git add . && git commit -m 'initial v1'", { cwd: tempDir, stdio: "ignore" });

      // Developer updates source to v2 without committing updated dist/
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 2;");

      const mockBuildFn = () => {
        const srcContent = fs.readFileSync(path.join(tempDir, "src/tool1.ts"), "utf8");
        const newDistContent = srcContent.includes("v = 2") ? "// v2 bundle output" : "// v1 bundle output";
        fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), newDistContent);
      };

      const result = verifyArtifactIntegrity(tempDir, {
        executeBuild: true,
        buildFn: mockBuildFn,
        checkGitStatus: true,
      });

      expect(result.valid).toBe(false);
      expect(result.staleArtifacts).toEqual([path.normalize("dist/tool1.mjs")]);
    });

    it("passes when source is changed, dist is regenerated, and committed together", () => {
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

      // Initial state: v1
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v1 bundle output");
      execSync("git add . && git commit -m 'initial v1'", { cwd: tempDir, stdio: "ignore" });

      // Developer updates source to v2 AND regenerates dist v2 AND commits
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 2;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// v2 bundle output");
      execSync("git add . && git commit -m 'update to v2'", { cwd: tempDir, stdio: "ignore" });

      const mockBuildFn = () => {
        const srcContent = fs.readFileSync(path.join(tempDir, "src/tool1.ts"), "utf8");
        const newDistContent = srcContent.includes("v = 2") ? "// v2 bundle output" : "// v1 bundle output";
        fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), newDistContent);
      };

      const result = verifyArtifactIntegrity(tempDir, {
        executeBuild: true,
        buildFn: mockBuildFn,
        checkGitStatus: true,
      });

      expect(result.valid).toBe(true);
      expect(result.staleArtifacts).toEqual([]);
    });

    it("Case F — build failure: fails verification when build step fails", () => {
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

      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 1;");
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// old dist file");

      const mockFailingBuildFn = () => {
        throw new Error("Build command exited with non-zero status 1");
      };

      const result = verifyArtifactIntegrity(tempDir, {
        executeBuild: true,
        buildFn: mockFailingBuildFn,
        checkGitStatus: false,
      });

      expect(result.valid).toBe(false);
      expect(result.buildFailed).toBe(true);
      expect(result.errors.some((e) => e.includes("Build command failed during artifact verification"))).toBe(
        true,
      );
    });

    it("fails verification when dist/ directory does not exist", () => {
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
      fs.writeFileSync(path.join(tempDir, "src/tool1.ts"), "export const v = 1;");

      const result = verifyArtifactIntegrity(tempDir, { executeBuild: false, checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("dist/ directory does not exist"))).toBe(true);
    });

    it("fails verification when source file is missing", () => {
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
      fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "dist/tool1.mjs"), "// built file");

      const result = verifyArtifactIntegrity(tempDir, { executeBuild: false, checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Source file missing for artifact 'tool1'"))).toBe(true);
    });
  });

  describe("runArtifactVerification CLI entrypoint", () => {
    it("exits process with code 1 when artifact verification fails", () => {
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

      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      runArtifactVerification(tempDir);

      expect(mockConsoleError).toHaveBeenCalledWith("Artifact Integrity Verification Failed:");
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });
  });
});
