import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executePythonWorkflow, run, sanitizePackageManager } from "../src/autofix";
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
      expect(execSync).toHaveBeenCalledWith("npm run format", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using pnpm for autofix/node/pnpm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/pnpm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "pnpm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("pnpm run format", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("pnpm run lint", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using bun for autofix/bun/bun/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/bun/bun/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "bun";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(execSync).toHaveBeenCalledWith("bun run format", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("bun run lint", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("should not run Python workflow in JS/TS-only repository", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/npm/basic");
      process.chdir(fixturePath);

      run();

      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
      expect(execSync).not.toHaveBeenCalledWith(expect.stringMatching(/pip install|uv sync/), expect.anything());
    });
  });

  describe("JS Dependency Installation Strategy & Working Directory", () => {
    let tempDir: string;

    beforeEach(() => {
      delete process.env.SKIP_JS_INSTALL;
      tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/temp install dir " + Math.random().toString(36).substring(2, 9));
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should execute commands with explicit custom working directory and support paths with spaces", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: npm install");
      expect(execSync).toHaveBeenCalledWith("npm install", { cwd: tempDir, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: tempDir, stdio: "inherit" });
    });

    it("should run 'pnpm install --no-frozen-lockfile' when pnpm-lock.yaml exists", () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: pnpm install --no-frozen-lockfile");
      expect(execSync).toHaveBeenCalledWith("pnpm install --no-frozen-lockfile", { cwd: tempDir, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("pnpm run check", { cwd: tempDir, stdio: "inherit" });
    });

    it("should run 'bun install' when bun.lock exists", () => {
      process.env.PACKAGE_MANAGER = "bun";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: bun install");
      expect(execSync).toHaveBeenCalledWith("bun install", { cwd: tempDir, stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("bun run check", { cwd: tempDir, stdio: "inherit" });
    });

    it("should skip JS installation when package.json has no applicable scripts", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
      expect(execSync).not.toHaveBeenCalledWith("npm install", expect.anything());
    });

    it("should skip JS installation when SKIP_JS_INSTALL=true but still run matching scripts", () => {
      process.env.SKIP_JS_INSTALL = "true";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));

      run(tempDir);

      expect(execSync).not.toHaveBeenCalledWith("npm install", expect.anything());
      expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: tempDir, stdio: "inherit" });
    });

    it("should exit with code 1 when JS dependency installation fails", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error("npm install failed");
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      run(tempDir);

      expect(core.error).toHaveBeenCalledWith("JS dependency installation failed: npm install");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Python Integration", () => {
    const pythonFixturesDir = path.resolve(originalCwd, "__tests__/fixtures/autofix/python");

    it("should execute Python workflow for uv fixture when Python source exists", () => {
      const fixturePath = path.join(pythonFixturesDir, "uv");

      run(fixturePath);

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(execSync).toHaveBeenCalledWith("uv sync", { cwd: fixturePath, stdio: "inherit" });
      expect(execSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
    });

    it("should install Python dependencies when executing Python workflow", () => {
      executePythonWorkflow(
        {
          name: "pip",
          installCommand: "pip install -r requirements.txt",
          execPrefix: "",
        },
        originalCwd,
      );

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(execSync).toHaveBeenCalledWith("pip install -r requirements.txt", { cwd: originalCwd, stdio: "inherit" });
      expect(execSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
    });

    it("should skip dependency installation when SKIP_PYTHON_INSTALL=true", () => {
      process.env.SKIP_PYTHON_INSTALL = "true";

      executePythonWorkflow({
        name: "pip",
        installCommand: "pip install -r requirements.txt",
        execPrefix: "",
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(execSync).not.toHaveBeenCalledWith("pip install -r requirements.txt", expect.anything());
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
    });

    it("should execute both JS scripts and Python dependency setup in mixed-language projects", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/mixed-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "npm run check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('mixed')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      try {
        run(tempDir);

        expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
        expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: tempDir, stdio: "inherit" });
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(execSync).toHaveBeenCalledWith("pip install -r requirements.txt", { cwd: tempDir, stdio: "inherit" });
        expect(execSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should error and exit if required package manager binary is not available in PATH without fallback attempt", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(false);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      executePythonWorkflow({
        name: "uv",
        installCommand: "uv sync",
        execPrefix: "uv run",
      });

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining("Required Python package manager 'uv' is not available in PATH"),
      );
      expect(execSync).not.toHaveBeenCalledWith("pip install uv", expect.anything());
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("should run Python workflow in Python-only repository without package.json when Python source exists", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/py-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('py-only')\n");

      try {
        run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only pyproject.toml and no .py files", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/pyproject-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'demo'\n");

      try {
        run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(execSync).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only [tool.ruff] configuration and no .py files", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/tool-ruff-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n");

      try {
        run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(execSync).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle failure in Python commands gracefully", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(true);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Install failed");
      });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      executePythonWorkflow({
        name: "pip",
        installCommand: "pip install -r requirements.txt",
        execPrefix: "",
      });

      expect(core.error).toHaveBeenCalledWith('Python command "pip install -r requirements.txt" failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
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
      expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("npm run format", { cwd: process.cwd(), stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("npm run fmt", { cwd: process.cwd(), stdio: "inherit" });
      expect(execSync).toHaveBeenCalledWith("npm run lint", { cwd: process.cwd(), stdio: "inherit" });
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

      expect(execSync).toHaveBeenCalledWith("npm run lint", { cwd: process.cwd(), stdio: "inherit" });
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

      expect(execSync).toHaveBeenCalledWith("npm run format", { cwd: process.cwd(), stdio: "inherit" });
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

      expect(execSync).toHaveBeenCalledWith("npm run fmt", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("pnpm run check", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("bun run check", { cwd: process.cwd(), stdio: "inherit" });
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
      expect(execSync).toHaveBeenCalledWith("npm run check", { cwd: process.cwd(), stdio: "inherit" });
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
