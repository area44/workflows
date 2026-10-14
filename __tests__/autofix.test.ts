import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executePythonWorkflow, run, sanitizePackageManager, synchronizeJsDependencies } from "../src/autofix";
import * as pythonEnv from "../src/python-env";

vi.mock("node:child_process");
vi.mock("@actions/core");

describe("autofix", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.PACKAGE_MANAGER = "npm";
    process.env.SKIP_JS_INSTALL = "true";
    delete process.env.SKIP_PYTHON_INSTALL;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
  });

  describe("Fixture-based test cases", () => {
    const fixturesDir = path.resolve(originalCwd, "__tests__/fixtures");

    it("should run format and lint scripts for autofix/node/npm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/npm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "npm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("npm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using pnpm for autofix/node/pnpm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/pnpm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "pnpm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("pnpm run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("pnpm run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using bun for autofix/bun/bun/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/bun/bun/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "bun";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("bun run format", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("bun run lint", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("Python Integration", () => {
    const pythonFixturesDir = path.resolve(originalCwd, "__tests__/fixtures/autofix/python");

    it("should execute Python workflow for uv fixture", () => {
      process.chdir(path.join(pythonFixturesDir, "uv"));

      run();

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(execSync).toHaveBeenCalledWith("uv sync", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("uv run ruff format .", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("uv run ruff check --fix .", { stdio: "inherit" });
    });

    it("should install Python dependencies and synchronize lockfile when executing Python workflow", () => {
      executePythonWorkflow({
        name: "poetry",
        installCommand: "poetry install",
        lockCommand: "poetry lock --no-update",
        syncCommand: "poetry install",
        execPrefix: "poetry run",
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: poetry");
      expect(core.info).toHaveBeenCalledWith("Synchronizing Python lockfile: poetry lock --no-update");
      expect(execSync).toHaveBeenCalledWith("poetry lock --no-update", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("poetry install", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("poetry run ruff format .", { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("poetry run ruff check --fix .", { stdio: "inherit" });
    });

    it("should skip lockfile sync and dependency installation for standalone Python projects", () => {
      executePythonWorkflow({
        name: "pip",
        installCommand: "",
        execPrefix: "",
        isStandalone: true,
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(execSync).not.toHaveBeenCalledWith("pip install", expect.anything());
      expect(execSync).toHaveBeenCalledWith(expect.stringMatching(/ruff format \.$/), { stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith(expect.stringMatching(/ruff check --fix \.$/), { stdio: "inherit" });
    });

    it("should execute both JS scripts and Python workflow in mixed-language projects", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/mixed-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "npm run check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('mixed')\n");

      process.chdir(tempDir);
      try {
        run();

        expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
        expect(execSync).toHaveBeenCalledWith("npm run check", { stdio: "inherit" });
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(execSync).toHaveBeenCalledWith(expect.stringMatching(/ruff format \.$/), { stdio: "inherit" });
        expect(execSync).toHaveBeenCalledWith(expect.stringMatching(/ruff check --fix \.$/), { stdio: "inherit" });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should error and exit if python and package manager binaries are not available", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(false);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      executePythonWorkflow({
        name: "uv",
        installCommand: "uv sync",
        execPrefix: "uv run",
      });

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining("Python environment or package manager 'uv' is not available in PATH"),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle failure in Python commands gracefully", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(true);
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (!cmd.startsWith("command -v") && !cmd.startsWith("where")) {
          throw new Error("Ruff failed");
        }
        return "" as any;
      });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      executePythonWorkflow({
        name: "pip",
        installCommand: "pip install ruff",
        execPrefix: "",
      });

      expect(core.error).toHaveBeenCalledWith('Python command "pip install ruff" failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("JS/TS Lockfile Synchronization", () => {
    it("should synchronize JS lockfile when lockfile is missing", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/js-sync-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "js-sync", scripts: { check: "echo ok" } }));

      try {
        synchronizeJsDependencies("npm", tempDir);

        expect(core.info).toHaveBeenCalledWith(
          expect.stringContaining("JS/TS lockfile (package-lock.json) is missing. Synchronizing dependencies: npm install"),
        );
        expect(execSync).toHaveBeenCalledWith("npm install", { stdio: "inherit" });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
    });

    it("should sanitize untrusted PACKAGE_MANAGER env values containing shell injection characters", () => {
      expect(sanitizePackageManager("npm; echo hack")).toBe("npm");
      expect(sanitizePackageManager("pnpm && calc")).toBe("npm");
      expect(sanitizePackageManager("bun")).toBe("bun");
      expect(sanitizePackageManager("pnpm-10")).toBe("pnpm-10");

      process.env.PACKAGE_MANAGER = "npm; rm -rf /";
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      expect(core.info).toHaveBeenCalledWith("Detected and executed script: check");
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it("should run both 'format' and 'lint' if they are both defined", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
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
