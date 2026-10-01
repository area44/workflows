import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { parseCommand, runBuildCommand, sanitizeCommandString } from "../src/build-command";

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
});
