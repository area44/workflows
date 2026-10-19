import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import fs from "node:fs";
import path from "node:path";
import { parseCommand, resolveBuildCommandToParse, runBuildCommand, validateBuildOutput } from "../src/pages/build-command";

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
      expect(core.info).toHaveBeenCalledWith('Preparing build command: "pnpm run build"');
      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["run", "build"], { ignoreReturnCode: true });
    });

    it("should execute DEFAULT_BUILD_COMMAND when set and BUILD_COMMAND is missing", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Preparing build command: "vpr build"');
      expect(exec.exec).toHaveBeenCalledWith("vpr", ["build"], { ignoreReturnCode: true });
    });

    it("should execute custom BUILD_COMMAND when provided", async () => {
      process.env.BUILD_COMMAND = "npm run build --token ghp_secret1234567890123456789012345";
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith(
        'Preparing build command: "npm run build --token ghp_secret1234567890123456789012345"',
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "build", "--token", "ghp_secret1234567890123456789012345"],
        { ignoreReturnCode: true },
      );
    });

    it("should handle failing build command with non-zero exit code and report message", async () => {
      process.env.BUILD_COMMAND = "npm run build";

      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Build command failed with exit code 2: npm run build',
      );
    });

    it("should handle exec throwing an exception and report actionable error message", async () => {
      process.env.BUILD_COMMAND = "nonexistent-cmd arg";

      vi.mocked(exec.exec).mockRejectedValue(
        new Error("Unable to locate executable file: nonexistent-cmd"),
      );

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Failed to execute build command "nonexistent-cmd arg": Unable to locate executable file: nonexistent-cmd',
      );
    });

    it("should handle command parse error and report actionable error message", async () => {
      process.env.BUILD_COMMAND = "npm run 'unclosed quote";

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Failed to parse build command "npm run \'unclosed quote": Unterminated quote in build command string.',
      );
    });

    it("should fail when build command succeeds but configured output directory does not exist", async () => {
      process.env.BUILD_COMMAND = "pnpm run build";
      process.env.BUILD_PATH = "non_existent_output_folder_99";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        "Configured build output directory 'non_existent_output_folder_99' does not exist.",
      );
    });

    it("should fail when build command succeeds but configured output directory is empty", async () => {
      const emptyDir = path.join(process.cwd(), "tmp_empty_dist_test");
      if (!fs.existsSync(emptyDir)) {
        fs.mkdirSync(emptyDir, { recursive: true });
      }

      try {
        process.env.BUILD_COMMAND = "npm run build";
        process.env.BUILD_PATH = "tmp_empty_dist_test";

        vi.mocked(exec.exec).mockResolvedValue(0);

        const exitCode = await runBuildCommand({ exitOnFailure: false });

        expect(exitCode).toBe(1);
        expect(core.setFailed).toHaveBeenCalledWith(
          "Configured build output directory 'tmp_empty_dist_test' is empty.",
        );
      } finally {
        fs.rmdirSync(emptyDir);
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
      expect(core.setFailed).toHaveBeenCalledWith("Build command failed with exit code 2: vp build");
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
      const testFile = path.join(process.cwd(), "tmp_file_not_dir.txt");
      fs.writeFileSync(testFile, "hello");

      try {
        expect(() => validateBuildOutput("tmp_file_not_dir.txt")).toThrow("Configured build output path 'tmp_file_not_dir.txt' is not a directory.");
      } finally {
        fs.rmSync(testFile, { force: true });
      }
    });

    it("should throw error if output directory exists but is empty", () => {
      const testDir = path.join(process.cwd(), "tmp_empty_output_dir");
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      try {
        expect(() => validateBuildOutput("tmp_empty_output_dir")).toThrow("Configured build output directory 'tmp_empty_output_dir' is empty.");
      } finally {
        fs.rmdirSync(testDir);
      }
    });

    it("should succeed if output directory exists and is non-empty", () => {
      const testDir = path.join(process.cwd(), "tmp_valid_output_dir");
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      fs.writeFileSync(path.join(testDir, "index.html"), "<h1>Test</h1>");

      try {
        expect(() => validateBuildOutput("tmp_valid_output_dir")).not.toThrow();
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("should succeed if output directory contains nested files and subdirectories", () => {
      const testDir = path.join(process.cwd(), "tmp_nested_output_dir");
      const nestedSubDir = path.join(testDir, "assets");
      fs.mkdirSync(nestedSubDir, { recursive: true });
      fs.writeFileSync(path.join(nestedSubDir, "app.js"), "console.log('test')");

      try {
        expect(() => validateBuildOutput("tmp_nested_output_dir")).not.toThrow();
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
