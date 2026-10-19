import * as core from "@actions/core";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executePythonWorkflow, executeRuffAutofix, run, sanitizePackageManager } from "../src/autofix/index";
import * as processUtils from "../src/process-utils";

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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
  });

  describe("Fixture-based test cases", () => {
    const fixturesDir = path.resolve(originalCwd, "__tests__/fixtures");

    const fixtureCases = [
      {
        fixture: "autofix/node/npm/basic",
        pm: "npm",
        installCmd: "npm install",
        expectedScripts: ["npm run format", "npm run lint"],
      },
      {
        fixture: "autofix/node/pnpm/basic",
        pm: "pnpm",
        installCmd: "pnpm install --no-frozen-lockfile",
        expectedScripts: ["pnpm run format", "pnpm run lint"],
      },
      {
        fixture: "autofix/bun/bun/basic",
        pm: "bun",
        installCmd: "bun install",
        expectedScripts: ["bun run format", "bun run lint"],
      },
    ];

    it.each(fixtureCases)(
      "should install dependencies and run scripts for $fixture",
      ({ fixture, pm, installCmd, expectedScripts }) => {
        const fixturePath = path.join(fixturesDir, fixture);
        process.chdir(fixturePath);
        process.env.PACKAGE_MANAGER = pm;

        run();

        expect(spawnSync).toHaveBeenCalledWith(installCmd, expect.objectContaining({ cwd: fixturePath, shell: true }));
        for (const script of expectedScripts) {
          expect(spawnSync).toHaveBeenCalledWith(script, expect.objectContaining({ cwd: fixturePath, shell: true }));
        }
        expect(spawnSync).toHaveBeenCalledTimes(1 + expectedScripts.length);
      },
    );

    it("should not run Python workflow in JS/TS-only repository", () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/npm/basic");
      process.chdir(fixturePath);

      run();

      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
      expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/pip install|uv sync/), expect.anything());
    });
  });

  describe("Lockfile Updates & Mutation Invariants", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/temp lockfile dir " + Math.random().toString(36).substring(2, 9));
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve updated package-lock.json when npm install synchronizes dependencies", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 2 }));

      vi.mocked(spawnSync).mockImplementation((cmd, opts) => {
        if (typeof cmd === "string" && cmd.startsWith("npm install")) {
          fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, updated: true }));
        }
        return { status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null } as any;
      });

      run(tempDir);

      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: tempDir, shell: true }));
      const updatedLock = JSON.parse(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf8"));
      expect(updatedLock).toEqual({ lockfileVersion: 3, updated: true });
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated pnpm-lock.yaml when pnpm install --no-frozen-lockfile updates lockfile", () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");

      vi.mocked(spawnSync).mockImplementation((cmd) => {
        if (typeof cmd === "string" && cmd.startsWith("pnpm install")) {
          fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\npackages:\n  foo: 1.0.0");
        }
        return { status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null } as any;
      });

      run(tempDir);

      expect(spawnSync).toHaveBeenCalledWith("pnpm install --no-frozen-lockfile", expect.objectContaining({ cwd: tempDir, shell: true }));
      const updatedLock = fs.readFileSync(path.join(tempDir, "pnpm-lock.yaml"), "utf8");
      expect(updatedLock).toContain("lockfileVersion: '9.0'");
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated bun.lock when bun install synchronizes dependencies", () => {
      process.env.PACKAGE_MANAGER = "bun";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "old bun lock content");

      vi.mocked(spawnSync).mockImplementation((cmd) => {
        if (typeof cmd === "string" && cmd.startsWith("bun install")) {
          fs.writeFileSync(path.join(tempDir, "bun.lock"), "new bun lock content with resolved hashes");
        }
        return { status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null } as any;
      });

      run(tempDir);

      expect(spawnSync).toHaveBeenCalledWith("bun install", expect.objectContaining({ cwd: tempDir, shell: true }));
      expect(fs.readFileSync(path.join(tempDir, "bun.lock"), "utf8")).toBe("new bun lock content with resolved hashes");
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated uv.lock when uv sync synchronizes Python dependencies", () => {
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'demo'\nversion = '0.1.0'\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n");

      vi.mocked(spawnSync).mockImplementation((cmd) => {
        if (typeof cmd === "string" && cmd.startsWith("uv sync")) {
          fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n[[package]]\nname = 'requests'\nversion = '2.31.0'\n");
        }
        return { status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null } as any;
      });

      run(tempDir);

      expect(spawnSync).toHaveBeenCalledWith("uv sync", expect.objectContaining({ cwd: tempDir, shell: true }));
      const updatedLock = fs.readFileSync(path.join(tempDir, "uv.lock"), "utf8");
      expect(updatedLock).toContain("name = 'requests'");
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe("JS Dependency Installation Strategy & Working Directory", () => {
    let tempDir: string;

    beforeEach(() => {
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

    it("should execute Python workflow and Ruff autofix for uv fixture when Python source exists", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
      const fixturePath = path.join(pythonFixturesDir, "uv");

      run(fixturePath);

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(spawnSync).toHaveBeenCalledWith("uv sync", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("ruff check --fix .", expect.objectContaining({ cwd: fixturePath, shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("ruff format .", expect.objectContaining({ cwd: fixturePath, shell: true }));
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

    it("should execute JS scripts, Python dependency setup, and Ruff in mixed-language projects in correct order", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
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
        expect(spawnSync).toHaveBeenCalledWith("ruff check --fix .", expect.objectContaining({ cwd: tempDir, shell: true }));
        expect(spawnSync).toHaveBeenCalledWith("ruff format .", expect.objectContaining({ cwd: tempDir, shell: true }));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should run Ruff lint before Ruff format in Python repository", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-order-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      const executedCommands: string[] = [];
      vi.mocked(spawnSync).mockImplementation((cmd) => {
        if (typeof cmd === "string") {
          executedCommands.push(cmd);
        }
        return { status: 0, stdout: "", stderr: "", pid: 1, output: [], signal: null } as any;
      });

      try {
        executeRuffAutofix(tempDir);

        expect(executedCommands).toEqual(["ruff check --fix .", "ruff format ."]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not execute Ruff commands in a non-Python repository", () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/non-py-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Hello");

      try {
        executeRuffAutofix(tempDir);

        expect(spawnSync).not.toHaveBeenCalledWith(expect.stringMatching(/ruff/), expect.anything());
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw WorkflowError when ruff executable is not available in PATH", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(false);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/no-ruff-bin-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        expect(() => executeRuffAutofix(tempDir)).toThrow(
          expect.objectContaining({
            name: "WorkflowError",
            code: "MISSING_CONFIGURATION",
            message: "Required Python binary 'ruff' is not available in PATH.",
            context: expect.objectContaining({
              stage: "python-environment-check",
              requiredBinary: "ruff",
              cwd: tempDir,
            }),
          }),
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should propagate non-zero ruff exit code as WorkflowError with COMMAND_EXECUTION_FAILURE", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-fail-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 1,
        stdout: "",
        stderr: "Ruff syntax error in file",
        pid: 1,
        output: [],
        signal: null,
      } as any);

      try {
        expect(() => executeRuffAutofix(tempDir)).toThrow(
          expect.objectContaining({
            name: "WorkflowError",
            code: "COMMAND_EXECUTION_FAILURE",
            message: 'Ruff command "ruff check --fix ." failed. Check Python and Ruff configuration.',
            context: expect.objectContaining({
              stage: "ruff-autofix-execution",
              command: "ruff check --fix .",
              cwd: tempDir,
            }),
          }),
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should execute Ruff in specified working directory", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-cwd-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        executeRuffAutofix(tempDir);

        expect(spawnSync).toHaveBeenCalledWith("ruff check --fix .", expect.objectContaining({ cwd: tempDir, shell: true }));
        expect(spawnSync).toHaveBeenCalledWith("ruff format .", expect.objectContaining({ cwd: tempDir, shell: true }));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should confirm action.yml has Setup Ruff before autofix mjs step and no duplicate ruff execution", () => {
      const actionYmlPath = path.resolve(originalCwd, "autofix/action.yml");
      const actionYmlContent = fs.readFileSync(actionYmlPath, "utf8");

      const setupRuffIdx = actionYmlContent.indexOf("- name: Setup Ruff");
      const updateProjectIdx = actionYmlContent.indexOf("- name: Run autofix");

      expect(setupRuffIdx).toBeGreaterThan(-1);
      expect(updateProjectIdx).toBeGreaterThan(-1);
      expect(setupRuffIdx).toBeLessThan(updateProjectIdx);
      expect(actionYmlContent).not.toContain("ruff check --fix .");
      expect(actionYmlContent).not.toContain("ruff format .");
    });

    it("should throw WorkflowError if required package manager binary is not available in PATH without fallback attempt", () => {
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(false);

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
      vi.spyOn(processUtils, "isExecutableAvailable").mockReturnValue(true);
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
    const scriptCases = [
      {
        name: "check script priority",
        scripts: { check: "echo check", format: "echo format", lint: "echo lint" },
        expectedCalls: ["npm run check"],
      },
      {
        name: "format and lint scripts",
        scripts: { format: "echo format", lint: "echo lint" },
        expectedCalls: ["npm run format", "npm run lint"],
      },
      {
        name: "fmt and lint scripts when format is absent",
        scripts: { fmt: "echo fmt", lint: "echo lint" },
        expectedCalls: ["npm run fmt", "npm run lint"],
      },
      {
        name: "format script only",
        scripts: { format: "echo format" },
        expectedCalls: ["npm run format"],
      },
      {
        name: "fmt script only",
        scripts: { fmt: "echo fmt" },
        expectedCalls: ["npm run fmt"],
      },
      {
        name: "lint script only",
        scripts: { lint: "echo lint" },
        expectedCalls: ["npm run lint"],
      },
    ];

    it.each(scriptCases)("should select correct script(s) for $name", ({ scripts, expectedCalls }) => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ scripts }) as any);

      run();

      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      for (const callCmd of expectedCalls) {
        expect(spawnSync).toHaveBeenCalledWith(callCmd, expect.objectContaining({ cwd: process.cwd(), shell: true }));
      }
      expect(spawnSync).toHaveBeenCalledTimes(1 + expectedCalls.length);
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
      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledWith("npm run check", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    it("should log info and skip script execution when scripts are empty or no matched script exists", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            foo: "echo foo",
          },
        }) as any,
      );

      run();

      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
    });

    it("should log info and skip script execution when scripts block is missing entirely in package.json", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ name: "my-package" }) as any);

      run();

      expect(spawnSync).toHaveBeenCalledWith("npm install", expect.objectContaining({ cwd: process.cwd(), shell: true }));
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
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
            stage: "js-project-inspection",
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

    it("should handle unclassified package.json inspection errors with SETUP_FAILURE", () => {
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
      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: "",
          stderr: "",
          pid: 1,
          output: [],
          signal: null,
        } as any)
        .mockReturnValueOnce({
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

      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: "",
          stderr: "",
          pid: 1,
          output: [],
          signal: null,
        } as any)
        .mockReturnValueOnce({
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
