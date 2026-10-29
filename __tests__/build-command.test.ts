import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  parseCommand,
  resolveBuildCommandToParse,
  resolveBuildOutputPath,
  runBuildCommand,
  validateBuildOutput,
} from "../src/pages/build-command";

vi.mock("@actions/core");
vi.mock("@actions/exec");

describe("build-command", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Action Launch Contract & Action.yml Structure for Pages", () => {
    it("should validate composite action contract structure, inputs, outputs, and execution guards in pages/action.yml", () => {
      const actionYmlPath = path.resolve(process.cwd(), "pages/action.yml");
      const actionYmlContent = fs.readFileSync(actionYmlPath, "utf8");
      const action = YAML.parse(actionYmlContent);

      expect(action.name).toBe("Build and Upload GitHub Pages Site");
      expect(action.runs.using).toBe("composite");

      // Inputs contract
      expect(action.inputs.path).toEqual({
        description: expect.any(String),
        required: false,
        default: "dist",
      });
      expect(action.inputs["build-command"]).toEqual({
        description: expect.any(String),
        required: false,
      });

      // Outputs contract with exact expression mappings
      expect(action.outputs["javascript-detected"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-detected }}",
      );
      expect(action.outputs["javascript-runtime"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-runtime }}",
      );
      expect(action.outputs["javascript-runtime-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-runtime-version }}",
      );
      expect(action.outputs["javascript-package-manager"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-package-manager }}",
      );
      expect(action.outputs["javascript-package-manager-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-package-manager-version }}",
      );
      expect(action.outputs["javascript-toolchain"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-toolchain }}",
      );
      expect(action.outputs["vp-version"].value).toBe("${{ steps.setup_vp.outputs.version }}");

      // Steps verification
      const steps = action.runs.steps;
      expect(Array.isArray(steps)).toBe(true);

      const resolveEnvStep = steps.find((s: any) => s.id === "resolve_environment");
      expect(resolveEnvStep).toBeDefined();
      expect(resolveEnvStep.run).toContain('node "$ACTION_PATH/../dist/resolve-environment.mjs"');

      const siteVarsStep = steps.find((s: any) => s.id === "set_site_variables");
      expect(siteVarsStep).toBeDefined();
      expect(siteVarsStep.run).toContain('node "$ACTION_PATH/../dist/site-variables.mjs"');
      expect(siteVarsStep.if).toContain("steps.resolve_environment.outcome == 'success'");

      const buildSiteStep = steps.find((s: any) => s.id === "build_site");
      expect(buildSiteStep).toBeDefined();
      expect(buildSiteStep.run).toContain('node "$ACTION_PATH/../dist/build-command.mjs"');
      expect(buildSiteStep.if).toContain("steps.resolve_environment.outcome == 'success'");
      expect(buildSiteStep.if).toContain(
        "steps.install_dependencies.outcome == 'success' || steps.setup_vp.outcome == 'success'",
      );

      // Upload artifact step guard
      const uploadStep = steps.find((s: any) => s.uses?.startsWith("actions/upload-pages-artifact"));
      expect(uploadStep).toBeDefined();
      expect(uploadStep.if).toContain("steps.resolve_environment.outcome == 'success'");
      expect(uploadStep.if).toContain("steps.build_site.outcome == 'success'");
      expect(uploadStep.with.path).toBe("${{ steps.build_site.outputs.path }}");

      // Verify referenced dist entrypoint files exist on disk
      expect(fs.existsSync(path.resolve(process.cwd(), "dist/resolve-environment.mjs"))).toBe(true);
      expect(fs.existsSync(path.resolve(process.cwd(), "dist/site-variables.mjs"))).toBe(true);
      expect(fs.existsSync(path.resolve(process.cwd(), "dist/build-command.mjs"))).toBe(true);
    });
  });

  describe("resolveBuildOutputPath", () => {
    it("should default to 'dist' when path is undefined or empty string", () => {
      expect(resolveBuildOutputPath(undefined)).toBe("dist");
      expect(resolveBuildOutputPath("")).toBe("dist");
    });

    it("should default to 'dist' when path is whitespace-only", () => {
      expect(resolveBuildOutputPath("   ")).toBe("dist");
      expect(resolveBuildOutputPath(" \t\n ")).toBe("dist");
    });

    it("should trim and return valid non-empty relative paths", () => {
      expect(resolveBuildOutputPath("out")).toBe("out");
      expect(resolveBuildOutputPath("  public  ")).toBe("public");
      expect(resolveBuildOutputPath("./build")).toBe("./build");
    });
  });

  describe("parseCommand", () => {
    it("should parse normal build commands correctly", () => {
      expect(parseCommand("npm run build")).toEqual({
        command: "npm",
        args: ["run", "build"],
      });

      expect(parseCommand("pnpm run build")).toEqual({
        command: "pnpm",
        args: ["run", "build"],
      });

      expect(parseCommand("vpr build")).toEqual({
        command: "vpr",
        args: ["build"],
      });
    });

    it("should handle single quote backslashes and Windows/Unix paths correctly", () => {
      // Inside single quotes, all backslashes must be preserved as literal
      expect(parseCommand("node build.js 'C:\\project\\dist' 'C:\\Users\\test'")).toEqual({
        command: "node",
        args: ["build.js", "C:\\project\\dist", "C:\\Users\\test"],
      });

      // Windows paths in double quotes or unquoted
      expect(parseCommand('node build.js "C:\\project\\dist" "C:\\Users\\test"')).toEqual({
        command: "node",
        args: ["build.js", "C:\\project\\dist", "C:\\Users\\test"],
      });

      expect(parseCommand("node build.js C:\\project\\dist C:\\Users\\test")).toEqual({
        command: "node",
        args: ["build.js", "C:\\project\\dist", "C:\\Users\\test"],
      });
    });

    it("should preserve empty quoted arguments", () => {
      expect(parseCommand('tool --output ""')).toEqual({
        command: "tool",
        args: ["--output", ""],
      });

      expect(parseCommand("tool --output ''")).toEqual({
        command: "tool",
        args: ["--output", ""],
      });

      expect(parseCommand('tool "" ""')).toEqual({
        command: "tool",
        args: ["", ""],
      });

      expect(parseCommand("tool '' ''")).toEqual({
        command: "tool",
        args: ["", ""],
      });
    });

    it("should handle arguments containing spaces inside double or single quotes", () => {
      expect(parseCommand('npm run build -- --outDir "dist dir"')).toEqual({
        command: "npm",
        args: ["run", "build", "--", "--outDir", "dist dir"],
      });

      expect(parseCommand("node build.js --title 'My Cool Site'")).toEqual({
        command: "node",
        args: ["build.js", "--title", "My Cool Site"],
      });

      expect(parseCommand("custom-tool --arg1 \"val 1\" --arg2 'val 2'")).toEqual({
        command: "custom-tool",
        args: ["--arg1", "val 1", "--arg2", "val 2"],
      });
    });

    it("should handle escaped characters and quotes", () => {
      expect(parseCommand("node build\\ script.js --flag")).toEqual({
        command: "node",
        args: ["build script.js", "--flag"],
      });

      expect(parseCommand("echo \"hello \\\"world\\\"\"")).toEqual({
        command: "echo",
        args: ["hello \"world\""],
      });
    });

    it("should handle executable path containing spaces when quoted", () => {
      expect(parseCommand('"/usr/local bin/node" build.js')).toEqual({
        command: "/usr/local bin/node",
        args: ["build.js"],
      });
    });

    it("should treat shell metacharacters as literal arguments without shell expansion", () => {
      const parsed = parseCommand("npm run build; echo injected");
      expect(parsed).toEqual({
        command: "npm",
        args: ["run", "build;", "echo", "injected"],
      });

      const parsed2 = parseCommand("pnpm build && rm -rf /");
      expect(parsed2).toEqual({
        command: "pnpm",
        args: ["build", "&&", "rm", "-rf", "/"],
      });

      const parsed3 = parseCommand("node script.js > output.txt");
      expect(parsed3).toEqual({
        command: "node",
        args: ["script.js", ">", "output.txt"],
      });

      const parsed4 = parseCommand("echo $VAR_NAME");
      expect(parsed4).toEqual({
        command: "echo",
        args: ["$VAR_NAME"],
      });
    });

    it("should throw actionable errors for empty or whitespace-only inputs", () => {
      expect(() => parseCommand("")).toThrow("Build command string is empty.");
      expect(() => parseCommand("   ")).toThrow("Build command string is empty.");
    });
  });

  describe("runBuildCommand", () => {
    it("should execute default build command based on PACKAGE_MANAGER when no custom command is set", async () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      delete process.env.BUILD_COMMAND;
      delete process.env.DEFAULT_BUILD_COMMAND;

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith("Preparing build command execution.");
      expect(core.info).toHaveBeenCalledWith("Executing build command: pnpm");
      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["run", "build"], { ignoreReturnCode: true });
    });

    it("should execute DEFAULT_BUILD_COMMAND when set and BUILD_COMMAND is missing", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith("Preparing build command execution.");
      expect(core.info).toHaveBeenCalledWith("Executing build command: vpr");
      expect(exec.exec).toHaveBeenCalledWith("vpr", ["build"], { ignoreReturnCode: true });
    });

    it("should execute custom BUILD_COMMAND when provided without logging raw sensitive flags in action logs", async () => {
      process.env.BUILD_COMMAND = "npm run build --token ghp_secret1234567890123456789012345";
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith("Preparing build command execution.");
      expect(core.info).toHaveBeenCalledWith("Executing build command: npm");
      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining("ghp_secret1234567890123456789012345"),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "build", "--token", "ghp_secret1234567890123456789012345"],
        { ignoreReturnCode: true },
      );
    });

    it("should handle failing build command with non-zero exit code without logging full user command string and without setting path output", async () => {
      process.env.BUILD_COMMAND = "npm run build --secret my-secret";

      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Build command execution failed with exit code 2.",
      );
      expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining("my-secret"));
      expect(core.setOutput).not.toHaveBeenCalledWith("path", expect.anything());
    });

    it("should handle exec throwing an exception and report actionable error message without user arguments", async () => {
      process.env.BUILD_COMMAND = "nonexistent-cmd secret-arg";

      vi.mocked(exec.exec).mockRejectedValue(
        new Error("Unable to locate executable file: nonexistent-cmd"),
      );

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to execute build command: Unable to locate executable file: nonexistent-cmd",
      );
      expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining("secret-arg"));
    });

    it("should handle command parse error and report actionable error message without full command", async () => {
      process.env.BUILD_COMMAND = "npm run 'unclosed quote secret-payload";

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to parse build command: Unterminated quote in build command string.",
      );
      expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining("secret-payload"));
    });

    it("should validate and set step output 'path' to 'dist' when BUILD_PATH is omitted or whitespace-only", async () => {
      delete process.env.BUILD_PATH;
      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.setOutput).toHaveBeenCalledWith("path", "dist");

      process.env.BUILD_PATH = "   ";
      const exitCode2 = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode2).toBe(0);
      expect(core.setOutput).toHaveBeenCalledWith("path", "dist");
    });

    it("should validate and set step output 'path' to trimmed BUILD_PATH when specified", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-custom-"));
      fs.writeFileSync(path.join(tempDir, "index.html"), "<h1>Custom Output</h1>");

      try {
        process.env.BUILD_PATH = `  ${tempDir}  `;
        vi.mocked(exec.exec).mockResolvedValue(0);

        const exitCode = await runBuildCommand({ exitOnFailure: false });

        expect(exitCode).toBe(0);
        expect(core.setOutput).toHaveBeenCalledWith("path", tempDir);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should validate and set step output 'path' to relative BUILD_PATH", async () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp_rel_build_out_"));
      const relPath = path.relative(process.cwd(), tempDir);
      fs.writeFileSync(path.join(tempDir, "index.html"), "<h1>Relative Build Output</h1>");

      try {
        process.env.BUILD_PATH = relPath;
        vi.mocked(exec.exec).mockResolvedValue(0);

        const exitCode = await runBuildCommand({ exitOnFailure: false });

        expect(exitCode).toBe(0);
        expect(core.setOutput).toHaveBeenCalledWith("path", relPath);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should fail when build command succeeds but configured output directory does not exist", async () => {
      process.env.BUILD_COMMAND = "pnpm run build";
      process.env.BUILD_PATH = "non_existent_output_folder_99";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Build output validation failed: Configured build output directory 'non_existent_output_folder_99' does not exist.",
      );
    });

    it("should report exact failure message for invalid build-command scenario 'npm run invalid-command-12345'", async () => {
      process.env.BUILD_COMMAND = "npm run invalid-command-12345";

      vi.mocked(exec.exec).mockResolvedValue(1);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Build command execution failed with exit code 1.",
      );
      expect(core.setOutput).not.toHaveBeenCalledWith("path", expect.anything());
    });

    it("should report exact failure message for missing output-directory scenario 'non_existent_output_dir_99'", async () => {
      process.env.BUILD_COMMAND = "npm run build";
      process.env.BUILD_PATH = "non_existent_output_dir_99";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Build output validation failed: Configured build output directory 'non_existent_output_dir_99' does not exist.",
      );
    });

    it("should fail when build command succeeds but configured output directory is empty", async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-empty-"));

      try {
        process.env.BUILD_COMMAND = "npm run build";
        process.env.BUILD_PATH = emptyDir;

        vi.mocked(exec.exec).mockResolvedValue(0);

        const exitCode = await runBuildCommand({ exitOnFailure: false });

        expect(exitCode).toBe(1);
        expect(core.setFailed).toHaveBeenCalledWith(
          `Build output validation failed: Configured build output directory '${emptyDir}' is empty.`,
        );
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveBuildCommandToParse", () => {
    it("should return custom command when supplied", async () => {
      const res = await resolveBuildCommandToParse("npm run custom", "vp build", "npm");
      expect(res).toBe("npm run custom");
    });

    it("should return package manager build command when custom and default commands are empty", async () => {
      const res = await resolveBuildCommandToParse("", "", "pnpm");
      expect(res).toBe("pnpm run build");
    });

    it("should resolve vp build directly when vp executable is available", async () => {
      const mockCheck = async (cmd: string) => cmd === "vp";
      const res = await resolveBuildCommandToParse("", "vp build", "npm", mockCheck);
      expect(res).toBe("vp build");
    });

    it("should fall back to vpr build when vp is unavailable and vpr is available", async () => {
      const mockCheck = async (cmd: string) => cmd === "vpr";
      const res = await resolveBuildCommandToParse("", "vp build", "npm", mockCheck);
      expect(res).toBe("vpr build");
      expect(core.info).toHaveBeenCalledWith(
        'Primary Vite+ executable "vp" unavailable. Falling back to "vpr".',
      );
    });

    it("should throw error when neither vp nor vpr is available", async () => {
      const mockCheck = async () => false;
      await expect(resolveBuildCommandToParse("", "vp build", "npm", mockCheck)).rejects.toThrow(
        'Primary Vite+ executable "vp" and fallback executable "vpr" are both unavailable in PATH.',
      );
    });
  });

  describe("Vite+ build fallback and error handling scenarios", () => {
    it("vp is available and vp build succeeds -> Success; do not invoke vpr", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(io, "which").mockImplementation(async (bin) => (bin === "vp" ? "/usr/bin/vp" : ""));
      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(exec.exec).toHaveBeenCalledWith("vp", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
    });

    it("vp is available but vp build exits non-zero -> Fail; do not invoke vpr", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(io, "which").mockImplementation(async (bin) => (bin === "vp" ? "/usr/bin/vp" : ""));
      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(exec.exec).toHaveBeenCalledWith("vp", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
      expect(core.setFailed).toHaveBeenCalledWith("Build command execution failed with exit code 2.");
    });

    it("vp is unavailable and vpr is available -> Run vpr build", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(io, "which").mockImplementation(async (bin) => (bin === "vpr" ? "/usr/bin/vpr" : ""));
      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith(
        'Primary Vite+ executable "vp" unavailable. Falling back to "vpr".',
      );
      expect(exec.exec).toHaveBeenCalledWith("vpr", ["build"], { ignoreReturnCode: true });
    });

    it("Neither executable is available -> Fail with actionable Error and exitOnFailure handling", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(io, "which").mockResolvedValue("");

      // Test with exitOnFailure: false -> should return 1 and core.setFailed without rejecting Promise
      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Failed to resolve build command: Primary Vite+ executable "vp" and fallback executable "vpr" are both unavailable in PATH.',
      );

      // Test with default failure mode (exitOnFailure: true) -> should call process.exit(1)
      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      await runBuildCommand({ exitOnFailure: true });
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it("A custom build-command is supplied -> Run custom command without automatic fallback", async () => {
      process.env.BUILD_COMMAND = "custom-builder build";
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(io, "which").mockResolvedValue("");
      vi.mocked(exec.exec).mockResolvedValue(1);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(exec.exec).toHaveBeenCalledWith("custom-builder", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
    });
  });

  describe("validateBuildOutput", () => {
    it("should throw error if output directory does not exist", () => {
      const testDir = "non_existent_output_dir_12345";
      expect(() => validateBuildOutput(testDir)).toThrow("Configured build output directory 'non_existent_output_dir_12345' does not exist.");
    });

    it("should throw error if output path is a file rather than a directory", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-file-"));
      const testFile = path.join(tempDir, "file.txt");
      fs.writeFileSync(testFile, "hello");

      try {
        expect(() => validateBuildOutput(testFile)).toThrow(`Configured build output path '${testFile}' is not a directory.`);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw error if output directory exists but is empty", () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-empty-"));

      try {
        expect(() => validateBuildOutput(testDir)).toThrow(`Configured build output directory '${testDir}' is empty.`);
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("should validate relative output path against explicit temporary working directory", () => {
      const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cwd-"));
      const relOutDir = "custom-relative-dist";
      const absOutDir = path.join(tempCwd, relOutDir);

      fs.mkdirSync(absOutDir, { recursive: true });
      fs.writeFileSync(path.join(absOutDir, "index.html"), "<h1>Test Relative</h1>");

      try {
        expect(validateBuildOutput(relOutDir, tempCwd)).toBe(relOutDir);

        expect(() => validateBuildOutput("missing-relative-dir", tempCwd)).toThrow(
          "Configured build output directory 'missing-relative-dir' does not exist.",
        );

        const emptyRelDir = "empty-relative-dir";
        fs.mkdirSync(path.join(tempCwd, emptyRelDir), { recursive: true });
        expect(() => validateBuildOutput(emptyRelDir, tempCwd)).toThrow(
          "Configured build output directory 'empty-relative-dir' is empty.",
        );
      } finally {
        fs.rmSync(tempCwd, { recursive: true, force: true });
      }
    });

    it("should default to 'dist' when given a whitespace-only path", () => {
      expect(() => validateBuildOutput("   ")).not.toThrow();
    });

    it("should handle filesystem read errors gracefully", () => {
      const spy = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      try {
        expect(() => validateBuildOutput("dist")).toThrow(
          "Unable to read configured build output directory 'dist': EACCES: permission denied",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("should succeed if output directory exists and is non-empty", () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-valid-"));
      fs.writeFileSync(path.join(testDir, "index.html"), "<h1>Test</h1>");

      try {
        expect(() => validateBuildOutput(testDir)).not.toThrow();
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("should succeed if output directory contains nested files and subdirectories", () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-build-cmd-nested-"));
      const nestedSubDir = path.join(testDir, "assets");
      fs.mkdirSync(nestedSubDir, { recursive: true });
      fs.writeFileSync(path.join(nestedSubDir, "app.js"), "console.log('test')");

      try {
        expect(() => validateBuildOutput(testDir)).not.toThrow();
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
