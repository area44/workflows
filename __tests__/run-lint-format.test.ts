import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { run } from "../src/run-lint-format";

vi.mock("node:child_process");
vi.mock("@actions/core");

describe("run-lint-format", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.PACKAGE_MANAGER = "npm";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
  });

  describe("Fixture-based test cases", () => {
    const fixturesDir = path.resolve(originalCwd, "__tests__/fixtures");

    it("should run format and lint scripts for lint-format/node/npm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "lint-format/node/npm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "npm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("npm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using pnpm for lint-format/node/pnpm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "lint-format/node/pnpm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "pnpm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("pnpm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("pnpm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using bun for lint-format/bun/bun/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "lint-format/bun/bun/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "bun";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("bun run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("bun run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("package.json existence checks", () => {
    it("should skip and log when package.json does not exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      run();

      expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
      expect(execSync).not.toHaveBeenCalled();
    });
  });

  describe("script execution routing", () => {
    it("should prioritize and run 'check' script if present", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo check",
            format: "echo format",
            lint: "echo lint",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
      expect(execSync).toHaveBeenCalledWith("npm run check", { stdio: "inherit" });
      expect(core.info).toHaveBeenCalledWith("Detected and executed script: check");
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("should run both 'format' and 'lint' if they are both defined", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            format: "echo format",
            lint: "echo lint",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("npm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run both 'fmt' and 'lint' if 'format' is missing but 'fmt' is defined", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            fmt: "echo fmt",
            lint: "echo lint",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: fmt, lint");
      expect(execSync).toHaveBeenCalledWith("npm run fmt", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should execute only 'lint' if format/fmt are not defined", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            lint: "echo lint",
          },
        }) as any,
      );

      run();

      expect(execSync).toHaveBeenCalledWith("npm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("should execute only 'format' if lint/fmt are not defined", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            format: "echo format",
          },
        }) as any,
      );

      run();

      expect(execSync).toHaveBeenCalledWith("npm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("should execute only 'fmt' if lint/format are not defined", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            fmt: "echo fmt",
          },
        }) as any,
      );

      run();

      expect(execSync).toHaveBeenCalledWith("npm run fmt", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("should log info and skip execution when scripts are empty or no matched script exists", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            foo: "echo foo",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
      expect(execSync).not.toHaveBeenCalled();
    });

    it("should log info and skip execution when scripts block is missing entirely in package.json", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ name: "my-package" }) as any);

      run();

      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
      expect(execSync).not.toHaveBeenCalled();
    });
  });

  describe("package manager environmental options", () => {
    it("should respect custom PACKAGE_MANAGER env variable values such as pnpm", () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo pnpm check",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Executing: pnpm run check");
      expect(execSync).toHaveBeenCalledWith("pnpm run check", { stdio: "inherit" });
    });

    it("should respect custom PACKAGE_MANAGER env variable values such as bun", () => {
      process.env.PACKAGE_MANAGER = "bun";
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo bun check",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Executing: bun run check");
      expect(execSync).toHaveBeenCalledWith("bun run check", { stdio: "inherit" });
    });

    it("should fall back to npm if PACKAGE_MANAGER environment variable is undefined or blank", () => {
      delete process.env.PACKAGE_MANAGER;
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo check",
          },
        }) as any,
      );

      run();

      expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
      expect(execSync).toHaveBeenCalledWith("npm run check", { stdio: "inherit" });
    });
  });

  describe("error and exception handling", () => {
    it("should set workflow as failed with error details when package.json parsing fails", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue("{ invalid json }" as any);

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Failed to run scripts:"),
      );
      expect(execSync).not.toHaveBeenCalled();
    });

    it("should log an error and exit with code 1 if a script fails during execution", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "exit 1",
          },
        }) as any,
      );
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Command failed: npm run check");
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      run();

      expect(core.error).toHaveBeenCalledWith('Script "check" failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should set workflow as failed for generic other errors such as filesystem failures on readFileSync", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Permission Denied");
      });

      run();

      expect(core.setFailed).toHaveBeenCalledWith("Failed to run scripts: Permission Denied");
    });

    it("should handle raw exceptions gracefully during run orchestration", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Raw unexpected error";
      });

      run();

      expect(core.setFailed).toHaveBeenCalledWith("Failed to run scripts: Raw unexpected error");
    });
  });
});
