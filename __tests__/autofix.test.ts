import * as core from "@actions/core";
import { execSync, spawnSync } from "node:child_process";
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(spawnSync).mockReset();
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    } as any);
    vi.mocked(execSync).mockReset();
    vi.mocked(execSync).mockReturnValue(Buffer.from("") as any);
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
      expect(spawnSync).toHaveBeenCalledWith("npm run format", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run lint", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using pnpm for autofix/node/pnpm/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/pnpm/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "pnpm";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(spawnSync).toHaveBeenCalledWith("pnpm run format", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("pnpm run lint", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should run format and lint scripts using bun for autofix/bun/bun/basic fixture", () => {
      const fixturePath = path.join(fixturesDir, "autofix/bun/bun/basic");
      process.chdir(fixturePath);
      process.env.PACKAGE_MANAGER = "bun";

      run();

      expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
      expect(spawnSync).toHaveBeenCalledWith("bun run format", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("bun run lint", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should not run Python workflow in JS/TS-only repository", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/npm/basic");
      process.chdir(fixturePath);

      run();

      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
      expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/pip install|uv sync/), expect.anything());
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
      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: tempDir, shell: true }));
    });

    it("should run 'pnpm install --no-frozen-lockfile' when pnpm-lock.yaml exists", () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: pnpm install --no-frozen-lockfile");
      expect(spawnSync).toHaveBeenCalledWith("pnpm install --no-frozen-lockfile", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("pnpm run check", expect.objectContaining({ cwd: tempDir, shell: true }));
    });

    it("should run 'bun install' when bun.lock exists", () => {
      process.env.PACKAGE_MANAGER = "bun";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: bun install");
      expect(spawnSync).toHaveBeenCalledWith("bun install", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("bun run check", expect.objectContaining({ cwd: tempDir, shell: true }));
    });

    it("should install JS dependencies even when package.json has no applicable scripts", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: npm install");
      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
    });

    it("should skip JS installation when SKIP_JS_INSTALL=true but still run matching scripts", () => {
      process.env.SKIP_JS_INSTALL = "true";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));

      run(tempDir);

      expect(spawnSync).not.toHaveBeenCalledWith("npm install", expect.anything());
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: tempDir, shell: true }));
    });

    it("should set workflow failed with WorkflowError when JS dependency installation fails", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "npm install failed",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      run(tempDir);

      expect(core.error).toHaveBeenCalledWith("JS dependency installation failed: npm install");
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "SETUP_FAILURE",
          message: expect.stringContaining("JS dependency installation failed executing \"npm install\""),
          context: expect.objectContaining({
            stage: "js-dependency-installation",
            packageManager: "npm",
            command: "npm install",
          }),
        }),
      );
    });
  });

  describe("Python Integration", () => {
    const pythonFixturesDir = path.resolve(originalCwd, "__tests__/fixtures/autofix/python");

    it("should execute Python workflow for uv fixture when Python source exists", () => {
      const fixturePath = path.join(pythonFixturesDir, "uv");

      run(fixturePath);

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(spawnSync).toHaveBeenCalledWith("uv sync", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
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
      expect(spawnSync).toHaveBeenCalledWith("pip install -r requirements.txt", expect.objectContaining({ cwd: originalCwd, shell: true }));
      expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
    });

    it("should skip dependency installation when SKIP_PYTHON_INSTALL=true", () => {
      process.env.SKIP_PYTHON_INSTALL = "true";

      executePythonWorkflow({
        name: "pip",
        installCommand: "pip install -r requirements.txt",
        execPrefix: "",
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(spawnSync).not.toHaveBeenCalledWith("pip install -r requirements.txt", expect.anything());
    });

    it("should skip lockfile sync and dependency installation for standalone Python projects", () => {
      executePythonWorkflow({
        name: "pip",
        installCommand: "",
        execPrefix: "",
        isStandalone: true,
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(spawnSync).not.toHaveBeenCalledWith("pip install", expect.anything());
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
        expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: tempDir, shell: true }));
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(spawnSync).toHaveBeenCalledWith("pip install -r requirements.txt", expect.objectContaining({ cwd: tempDir, shell: true }));
        expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw WorkflowError if required package manager binary is not available in PATH without fallback attempt", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(false);

      expect(() =>
        executePythonWorkflow({
          name: "uv",
          installCommand: "uv sync",
          execPrefix: "uv run",
        }),
      ).toThrow(
        expect.objectContaining({
          name: "WorkflowError",
          code: "MISSING_CONFIGURATION",
          message: "Required Python package manager 'uv' is not available in PATH.",
          context: expect.objectContaining({
            stage: "python-environment-check",
            packageManager: "uv",
            requiredBinary: "uv",
          }),
        }),
      );

      expect(core.error).toHaveBeenCalledWith(
        "Required Python package manager 'uv' is not available in PATH.",
      );
      expect(spawnSync).not.toHaveBeenCalledWith("pip install uv", expect.anything());
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
        expect(spawnSync).not.toHaveBeenCalled();
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
        expect(spawnSync).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle failure in Python commands gracefully throwing WorkflowError", () => {
      vi.spyOn(pythonEnv, "isExecutableAvailable").mockReturnValue(true);
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Install failed",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      expect(() =>
        executePythonWorkflow({
          name: "pip",
          installCommand: "pip install -r requirements.txt",
          execPrefix: "",
        }),
      ).toThrow(
        expect.objectContaining({
          name: "WorkflowError",
          code: "SETUP_FAILURE",
          message: expect.stringContaining('Python command "pip install -r requirements.txt" failed'),
          context: expect.objectContaining({
            stage: "python-dependency-installation",
            packageManager: "pip",
            command: "pip install -r requirements.txt",
          }),
        }),
      );

      expect(core.error).toHaveBeenCalledWith('Python command "pip install -r requirements.txt" failed');
    });
  });

  describe("package.json existence checks", () => {
    it("should skip and log when package.json does not exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      run();

      expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
      expect(spawnSync).not.toHaveBeenCalled();
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
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
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
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(core.info).toHaveBeenCalledWith("Detected and executed script: check");
      expect(spawnSync).toHaveBeenCalledTimes(1);
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
      expect(spawnSync).toHaveBeenCalledWith("npm run format", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run lint", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
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
      expect(spawnSync).toHaveBeenCalledWith("npm run fmt", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run lint", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
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

      expect(spawnSync).toHaveBeenCalledWith("npm run lint", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(1);
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

      expect(spawnSync).toHaveBeenCalledWith("npm run format", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(1);
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

      expect(spawnSync).toHaveBeenCalledWith("npm run fmt", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(1);
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
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("should log info and skip execution when scripts block is missing entirely in package.json", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ name: "my-package" }) as any);

      run();

      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
      expect(spawnSync).not.toHaveBeenCalled();
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
      expect(spawnSync).toHaveBeenCalledWith("pnpm run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
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
      expect(spawnSync).toHaveBeenCalledWith("bun run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
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
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
    });
  });

  describe("error and exception handling", () => {
    it("should set INVALID_INPUT when package.json contains malformed JSON syntax", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue("{ invalid json syntax }" as any);

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "INVALID_INPUT",
          message: expect.stringContaining("Failed to parse package.json:"),
          context: expect.objectContaining({
            stage: "js-project-parsing",
          }),
        }),
      );
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("should set SETUP_FAILURE when package.json encounters a read/file access error", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied, open 'package.json'");
      });

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "SETUP_FAILURE",
          message: expect.stringContaining("Failed to read package.json: EACCES: permission denied"),
          context: expect.objectContaining({
            stage: "js-project-inspection",
          }),
        }),
      );
    });

    it("should handle unclassified package.json inspection errors with neutral error reporting and SETUP_FAILURE", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw "Raw unexpected filesystem error";
      });

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "SETUP_FAILURE",
          message: "Failed to read package.json: Raw unexpected filesystem error",
          context: expect.objectContaining({
            stage: "js-project-inspection",
          }),
        }),
      );
    });

    it("should log an error and set workflow as failed if a script fails during execution", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "exit 1",
          },
        }) as any,
      );
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Command failed: npm run check",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      run();

      expect(core.error).toHaveBeenCalledWith('Script "check" failed');
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "COMMAND_EXECUTION_FAILURE",
          message: 'Script "check" failed while executing "npm run check".',
          context: expect.objectContaining({
            stage: "js-script-execution",
            script: "check",
            packageManager: "npm",
            command: "npm run check",
          }),
        }),
      );
    });
  });

  describe("Secret Sanitization and File Safety", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/temp safety dir " + Math.random().toString(36).substring(2, 9));
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should sanitize secrets/tokens in command strings when reporting installation failures", () => {
      delete process.env.SKIP_JS_INSTALL;
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      process.env.PACKAGE_MANAGER = "npm";
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Failed to connect with token ghp_123456789012345678901234567890123456",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      run(tempDir);

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "SETUP_FAILURE",
          context: expect.objectContaining({
            cause: expect.objectContaining({
              message: expect.not.stringContaining("ghp_123456789012345678901234567890123456"),
            }),
          }),
        }),
      );
    });

    it("should sanitize tokens and secrets in nested error causes for generic script execution failures", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "exit 1",
          },
        }) as any,
      );

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Execution failed with token github_pat_11AAAAAA1111111111111111111111111111111111111111111111111111111111111111111111",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkflowError",
          code: "COMMAND_EXECUTION_FAILURE",
          context: expect.objectContaining({
            cause: expect.objectContaining({
              message: expect.not.stringContaining("github_pat_11AAAAAA1111111111111111111111111111111111111111111111111111111111111111111111"),
            }),
          }),
        }),
      );
    });

    it("should preserve existing user files and not perform destructive cleanups on failure", () => {
      const userFile = path.join(tempDir, "unrelated-user-file.txt");
      fs.writeFileSync(userFile, "important user content");
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "exit 1" } }));

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Script failed",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      run(tempDir);

      expect(core.setFailed).toHaveBeenCalled();
      expect(fs.existsSync(userFile)).toBe(true);
      expect(fs.readFileSync(userFile, "utf8")).toBe("important user content");
    });
  });
});
