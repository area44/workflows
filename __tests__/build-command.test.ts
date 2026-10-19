import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import fs from "node:fs";
import path from "node:path";
import { parseCommand, resolveBuildCommandToParse, runBuildCommand, sanitizeCommandString, validateBuildOutput } from "../src/pages/build-command";
import * as processUtils from "../src/process-utils";

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

  describe("sanitizeCommandString", () => {
    it("should mask URLs containing auth credentials", () => {
      expect(sanitizeCommandString("git clone https://user:secret-token@github.com/repo.git")).toBe(
        "git clone https://***:***@github.com/repo.git",
      );
    });

    it("should mask sensitive CLI flag values", () => {
      expect(sanitizeCommandString("npm run build --token=secret-value")).toBe(
        "npm run build --token=***",
      );

      expect(sanitizeCommandString("pnpm deploy --api-key my-secret-key")).toBe(
        "pnpm deploy --api-key ***",
      );

      expect(sanitizeCommandString("tool --auth my-pass")).toBe("tool --auth ***");
    });

    it("should mask common secret tokens like GitHub PATs", () => {
      expect(
        sanitizeCommandString("npm run build --token ghp_123456789012345678901234567890123456"),
      ).toBe("npm run build --token ***");
    });

    it("should leave non-sensitive commands unchanged", () => {
      expect(sanitizeCommandString("npm run build --outDir dist")).toBe(
        "npm run build --outDir dist",
      );
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

    it("should execute custom BUILD_COMMAND when provided and sanitize logs", async () => {
      process.env.BUILD_COMMAND = "npm run build --token ghp_secret1234567890123456789012345";
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith('Preparing build command: "npm run build --token ***"');
      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "build", "--token", "ghp_secret1234567890123456789012345"],
        { ignoreReturnCode: true },
      );
    });

    it("should handle failing build command with non-zero exit code and sanitize command in WorkflowError message and context", async () => {
      process.env.BUILD_COMMAND = "npm run build --token=ghp_secret1234567890123456789012345";

      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "COMMAND_EXECUTION_FAILURE",
          message: 'Build command failed with exit code 2: npm run build --token=***',
          context: expect.objectContaining({
            command: 'npm run build --token=***',
          }),
        }),
      );
    });

    it("should sanitize secrets in WorkflowError message and context when exec throws an error containing sensitive tokens or URLs", async () => {
      const secretToken = "ghp_123456789012345678901234567890123456";
      const secretPass = "super_secret_pass";
      process.env.BUILD_COMMAND = `npm run build --token=${secretToken} https://user:${secretPass}@github.com/repo.git`;

      vi.mocked(exec.exec).mockRejectedValue(
        new Error(`Failed to fetch from https://user:${secretPass}@github.com/repo.git using token ${secretToken}`),
      );

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      const setFailedArg = vi.mocked(core.setFailed).mock.calls[0][0];
      const serialized = JSON.stringify(setFailedArg);

      expect(serialized).not.toContain(secretToken);
      expect(serialized).not.toContain(secretPass);
      expect(serialized).toContain("https://***:***@github.com/repo.git");
      expect(serialized).toContain("--token=***");
    });

    it("should sanitize secrets in WorkflowError message and context for malformed commands containing sensitive flags and credential URLs", async () => {
      const secretVal = "my_secret_token_value_999";
      const secretPass = "my_secret_password_777";
      process.env.BUILD_COMMAND = `npm run build --token=${secretVal} https://admin:${secretPass}@example.com 'unclosed quote`;

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      const setFailedArg = vi.mocked(core.setFailed).mock.calls[0][0] as any;

      expect(setFailedArg.code).toBe("INVALID_INPUT");
      expect(setFailedArg.message).toBe("Unterminated quote in build command string.");

      const serialized = JSON.stringify(setFailedArg);
      expect(serialized).not.toContain(secretVal);
      expect(serialized).not.toContain(secretPass);
    });

    it("should handle exec throwing an exception and report actionable error message with COMMAND_EXECUTION_FAILURE WorkflowError", async () => {
      process.env.BUILD_COMMAND = "nonexistent-cmd arg";

      vi.mocked(exec.exec).mockRejectedValue(
        new Error("Unable to locate executable file: nonexistent-cmd"),
      );

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "COMMAND_EXECUTION_FAILURE",
          message: 'Failed to execute build command "nonexistent-cmd arg": Unable to locate executable file: nonexistent-cmd',
        }),
      );
    });

    it("should handle command parse error and report actionable error message preserving WorkflowError INVALID_INPUT", async () => {
      process.env.BUILD_COMMAND = "npm run 'unclosed quote";

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "INVALID_INPUT",
          message: "Unterminated quote in build command string.",
        }),
      );
    });
  });

  describe("resolveBuildCommandToParse", () => {
    it("should return custom command when supplied", () => {
      const res = resolveBuildCommandToParse("npm run custom", "vp build", "npm");
      expect(res).toBe("npm run custom");
    });

    it("should return package manager build command when custom and default commands are empty", () => {
      const res = resolveBuildCommandToParse("", "", "pnpm");
      expect(res).toBe("pnpm run build");
    });

    it("should resolve vp build directly when vp executable is available", () => {
      const mockCheck = (cmd: string) => cmd === "vp";
      const res = resolveBuildCommandToParse("", "vp build", "npm", mockCheck);
      expect(res).toBe("vp build");
    });

    it("should fall back to vpr build when vp is unavailable and vpr is available", () => {
      const mockCheck = (cmd: string) => cmd === "vpr";
      const res = resolveBuildCommandToParse("", "vp build", "npm", mockCheck);
      expect(res).toBe("vpr build");
      expect(core.info).toHaveBeenCalledWith(
        'Primary Vite+ executable "vp" unavailable. Falling back to "vpr".',
      );
    });

    it("should throw WorkflowError MISSING_CONFIGURATION when neither vp nor vpr is available", () => {
      const mockCheck = () => false;
      expect(() => resolveBuildCommandToParse("", "vp build", "npm", mockCheck)).toThrow(
        expect.objectContaining({
          code: "MISSING_CONFIGURATION",
          message: 'Primary Vite+ executable "vp" and fallback executable "vpr" are both unavailable in PATH.',
        }),
      );
    });
  });

  describe("Vite+ build fallback and error handling scenarios", () => {
    it("vp is available and vp build succeeds -> Success; do not invoke vpr", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(processUtils, "isExecutableAvailable").mockImplementation((bin) => bin === "vp");
      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(exec.exec).toHaveBeenCalledWith("vp", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
    });

    it("vp is available but vp build exits non-zero -> Fail; do not invoke vpr", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(processUtils, "isExecutableAvailable").mockImplementation((bin) => bin === "vp");
      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(exec.exec).toHaveBeenCalledWith("vp", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "COMMAND_EXECUTION_FAILURE",
          message: "Build command failed with exit code 2: vp build",
        }),
      );
    });

    it("vp is unavailable and vpr is available -> Run vpr build", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(processUtils, "isExecutableAvailable").mockImplementation((bin) => bin === "vpr");
      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith(
        'Primary Vite+ executable "vp" unavailable. Falling back to "vpr".',
      );
      expect(exec.exec).toHaveBeenCalledWith("vpr", ["build"], { ignoreReturnCode: true });
    });

    it("Neither executable is available -> Fail with actionable WorkflowError and exitOnFailure handling", async () => {
      delete process.env.BUILD_COMMAND;
      process.env.DEFAULT_BUILD_COMMAND = "vp build";

      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(false);

      // Test with exitOnFailure: false -> should return 1 and core.setFailed without rejecting Promise
      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MISSING_CONFIGURATION",
          message: 'Primary Vite+ executable "vp" and fallback executable "vpr" are both unavailable in PATH.',
        }),
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

      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(false);
      vi.mocked(exec.exec).mockResolvedValue(1);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(1);
      expect(exec.exec).toHaveBeenCalledWith("custom-builder", ["build"], { ignoreReturnCode: true });
      expect(exec.exec).not.toHaveBeenCalledWith("vpr", expect.anything(), expect.anything());
    });
  });

  describe("validateBuildOutput", () => {
    it("should throw WorkflowError if output directory does not exist", () => {
      const testDir = "non_existent_output_dir_12345";
      expect(() => validateBuildOutput(testDir)).toThrow("Configured build output directory 'non_existent_output_dir_12345' does not exist.");
    });

    it("should throw WorkflowError if output path is a file rather than a directory", () => {
      const testFile = path.join(process.cwd(), "tmp_file_not_dir.txt");
      fs.writeFileSync(testFile, "hello");

      try {
        expect(() => validateBuildOutput("tmp_file_not_dir.txt")).toThrow("Configured build output path 'tmp_file_not_dir.txt' is not a directory.");
      } finally {
        fs.rmSync(testFile, { force: true });
      }
    });

    it("should throw WorkflowError if output directory exists but is empty", () => {
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
