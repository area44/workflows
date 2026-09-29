import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { parseCommand, runBuildCommand } from "../src/build-command";

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

    it("should handle arguments containing spaces inside double or single quotes", () => {
      expect(parseCommand("npm run build -- --outDir \"dist dir\"")).toEqual({
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
      process.env.BUILD_COMMAND = "npm run build:pages -- --outDir 'my dist'";
      process.env.DEFAULT_BUILD_COMMAND = "vpr build";

      vi.mocked(exec.exec).mockResolvedValue(0);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(0);
      expect(core.info).toHaveBeenCalledWith(
        'Preparing build command: "npm run build:pages -- --outDir \'my dist\'"',
      );
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "build:pages", "--", "--outDir", "my dist"], {
        ignoreReturnCode: true,
      });
    });

    it("should handle failing build command with non-zero exit code and set workflow failure", async () => {
      process.env.BUILD_COMMAND = "node -e \"process.exit(2)\"";

      vi.mocked(exec.exec).mockResolvedValue(2);

      const exitCode = await runBuildCommand({ exitOnFailure: false });

      expect(exitCode).toBe(2);
      expect(core.setFailed).toHaveBeenCalledWith(
        'Build command failed with exit code 2: node -e "process.exit(2)"',
      );
    });

    it("should handle exec throwing an exception and report actionable error message", async () => {
      process.env.BUILD_COMMAND = "nonexistent-cmd arg";

      vi.mocked(exec.exec).mockRejectedValue(new Error("Unable to locate executable file: nonexistent-cmd"));

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
  });
});
