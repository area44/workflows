import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { executePythonWorkflow, executeRuffAutofix, run, sanitizePackageManager } from "../src/autofix/index";

vi.mock("@actions/exec");
vi.mock("@actions/core");

describe("autofix", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(exec.exec).mockReset();
    vi.mocked(exec.exec).mockResolvedValue(0);
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
        executable: "npm",
        installArgs: ["install"],
        expectedScriptNames: ["format", "lint"],
      },
      {
        fixture: "autofix/node/pnpm/basic",
        pm: "pnpm",
        executable: "pnpm",
        installArgs: ["install", "--no-frozen-lockfile"],
        expectedScriptNames: ["format", "lint"],
      },
      {
        fixture: "autofix/bun/bun/basic",
        pm: "bun",
        executable: "bun",
        installArgs: ["install"],
        expectedScriptNames: ["format", "lint"],
      },
    ];

    it.each(fixtureCases)(
      "should install dependencies and run scripts for $fixture using @actions/exec",
      async ({ fixture, pm, executable, installArgs, expectedScriptNames }) => {
        const fixturePath = path.join(fixturesDir, fixture);
        process.chdir(fixturePath);
        process.env.PACKAGE_MANAGER = pm;

        await run();

        expect(exec.exec).toHaveBeenCalledWith(executable, installArgs, expect.objectContaining({ cwd: fixturePath }));
        for (const scriptName of expectedScriptNames) {
          expect(exec.exec).toHaveBeenCalledWith(executable, ["run", scriptName], expect.objectContaining({ cwd: fixturePath }));
        }
        expect(exec.exec).toHaveBeenCalledTimes(1 + expectedScriptNames.length);
      },
    );

    it("should not run Python workflow in JS/TS-only repository", async () => {
      const fixturePath = path.join(fixturesDir, "autofix/node/npm/basic");
      process.chdir(fixturePath);

      await run();

      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
      expect(exec.exec).not.toHaveBeenCalledWith(expect.stringMatching(/pip|uv/), expect.anything(), expect.anything());
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

    it("should preserve updated package-lock.json when npm install synchronizes dependencies", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 2 }));

      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        if (executable === "npm" && args?.[0] === "install") {
          fs.writeFileSync(path.join(tempDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, updated: true }));
        }
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
      const updatedLock = JSON.parse(fs.readFileSync(path.join(tempDir, "package-lock.json"), "utf8"));
      expect(updatedLock).toEqual({ lockfileVersion: 3, updated: true });
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated pnpm-lock.yaml when pnpm install --no-frozen-lockfile updates lockfile", async () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");

      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        if (executable === "pnpm" && args?.[0] === "install") {
          fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\npackages:\n  foo: 1.0.0");
        }
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["install", "--no-frozen-lockfile"], expect.objectContaining({ cwd: tempDir }));
      const updatedLock = fs.readFileSync(path.join(tempDir, "pnpm-lock.yaml"), "utf8");
      expect(updatedLock).toContain("lockfileVersion: '9.0'");
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated bun.lock when bun install synchronizes dependencies", async () => {
      process.env.PACKAGE_MANAGER = "bun";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "old bun lock content");

      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        if (executable === "bun" && args?.[0] === "install") {
          fs.writeFileSync(path.join(tempDir, "bun.lock"), "new bun lock content with resolved hashes");
        }
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("bun", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(fs.readFileSync(path.join(tempDir, "bun.lock"), "utf8")).toBe("new bun lock content with resolved hashes");
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should preserve updated uv.lock when uv sync synchronizes Python dependencies", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'demo'\nversion = '0.1.0'\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n");

      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        if (executable === "uv" && args?.[0] === "sync") {
          fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n[[package]]\nname = 'requests'\nversion = '2.31.0'\n");
        }
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("uv", ["sync"], expect.objectContaining({ cwd: tempDir }));
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

    it("should execute commands with explicit custom working directory and support paths with spaces", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      await run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: npm install");
      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
    });

    it("should run 'pnpm install --no-frozen-lockfile' when pnpm-lock.yaml exists", async () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      await run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: pnpm install --no-frozen-lockfile");
      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["install", "--no-frozen-lockfile"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
    });

    it("should run 'bun install' when bun.lock exists", async () => {
      process.env.PACKAGE_MANAGER = "bun";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      await run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: bun install");
      expect(exec.exec).toHaveBeenCalledWith("bun", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("bun", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
    });

    it("should install JS dependencies even when package.json has no applicable scripts", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      await run(tempDir);

      expect(core.info).toHaveBeenCalledWith("Installing JS dependencies: npm install");
      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
    });

    it("should set workflow failed when JS dependency installation fails", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");

      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      await run(tempDir);

      expect(core.error).toHaveBeenCalledWith("JS dependency installation failed: npm install");
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to run scripts: JS dependency installation failed executing "npm install"'),
      );
    });
  });

  describe("Python Integration", () => {
    const pythonFixturesDir = path.resolve(originalCwd, "__tests__/fixtures/autofix/python");

    it("should execute Python workflow and Ruff autofix for uv fixture when Python source exists", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const fixturePath = path.join(pythonFixturesDir, "uv");

      await run(fixturePath);

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(exec.exec).toHaveBeenCalledWith("uv", ["sync"], expect.objectContaining({ cwd: fixturePath }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: fixturePath }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: fixturePath }));
    });

    it("should install Python dependencies when executing Python workflow", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      await executePythonWorkflow(
        {
          name: "pip",
          installCommand: "pip install -r requirements.txt",
          execPrefix: "",
        },
        originalCwd,
      );

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: originalCwd }));
    });

    it("should execute compound pip installation commands sequentially and stop on failure", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      await executePythonWorkflow(
        {
          name: "pip",
          installCommand: "pip install -r requirements.txt && pip install -e .",
          execPrefix: "",
        },
        originalCwd,
      );

      expect(exec.exec).toHaveBeenNthCalledWith(1, "pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: originalCwd }));
      expect(exec.exec).toHaveBeenNthCalledWith(2, "pip", ["install", "-e", "."], expect.objectContaining({ cwd: originalCwd }));
    });

    it("should stop execution of compound pip command if first command fails", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      await expect(
        executePythonWorkflow(
          {
            name: "pip",
            installCommand: "pip install -r requirements.txt && pip install -e .",
            execPrefix: "",
          },
          originalCwd,
        ),
      ).rejects.toThrow("Python command \"pip install -r requirements.txt\" failed.");

      expect(exec.exec).toHaveBeenCalledTimes(1);
      expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.anything());
    });

    it("should skip lockfile sync and dependency installation for standalone Python projects", async () => {
      await executePythonWorkflow({
        name: "pip",
        installCommand: "",
        execPrefix: "",
        isStandalone: true,
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(exec.exec).not.toHaveBeenCalledWith("pip", expect.anything(), expect.anything());
    });

    it("should execute JS scripts, Python dependency setup, and Ruff in mixed-language projects in correct order", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/mixed-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "npm run check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('mixed')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      try {
        await run(tempDir);

        expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
        expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: tempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: tempDir }));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should run Ruff lint before Ruff format in Python repository", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-order-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      const executedCommands: string[] = [];
      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        executedCommands.push(`${executable} ${(args || []).join(" ")}`.trim());
        return 0;
      });

      try {
        await executeRuffAutofix(tempDir);

        expect(executedCommands).toEqual(["ruff check --fix .", "ruff format ."]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not execute Ruff commands in a non-Python repository", async () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/non-py-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Hello");

      try {
        await executeRuffAutofix(tempDir);

        expect(exec.exec).not.toHaveBeenCalledWith("ruff", expect.anything(), expect.anything());
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw error when ruff executable is not available in PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/no-ruff-bin-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        await expect(executeRuffAutofix(tempDir)).rejects.toThrow("Required Python binary 'ruff' is not available in PATH.");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should propagate non-zero ruff exit code as Error", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-fail-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      try {
        await expect(executeRuffAutofix(tempDir)).rejects.toThrow('Ruff command "ruff check --fix ." failed. Check Python and Ruff configuration.');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should execute Ruff in specified working directory", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/ruff-cwd-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        await executeRuffAutofix(tempDir);

        expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: tempDir }));
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

    it("should throw Error if required package manager binary is not available in PATH without fallback attempt", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");

      await expect(
        executePythonWorkflow({
          name: "uv",
          installCommand: "uv sync",
          execPrefix: "uv run",
        }),
      ).rejects.toThrow("Required Python package manager 'uv' is not available in PATH.");

      expect(core.error).toHaveBeenCalledWith(
        "Required Python package manager 'uv' is not available in PATH.",
      );
      expect(exec.exec).not.toHaveBeenCalledWith("pip", expect.anything(), expect.anything());
    });

    it("should run Python workflow in Python-only repository without package.json when Python source exists", async () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/py-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('py-only')\n");

      try {
        await run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only pyproject.toml and no .py files", async () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/pyproject-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'demo'\n");

      try {
        await run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(exec.exec).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only [tool.ruff] configuration and no .py files", async () => {
      const tempDir = path.join(originalCwd, "__tests__/fixtures/autofix/python/tool-ruff-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n");

      try {
        await run(tempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(exec.exec).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw Error for unsupported or malformed Python install command string", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommand: "pip install --invalid-flag-syntax && rm -rf /",
          execPrefix: "",
        }),
      ).rejects.toThrow("Unsupported or malformed Python install command configuration");
    });

    it("should pass arguments containing spaces unchanged when structured PythonInstallCommand is used", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);

      await executePythonWorkflow({
        name: "pip",
        installCommand: "pip install -r requirements.txt",
        installCommands: [
          { executable: "pip", args: ["install", "-r", "path with spaces/requirements.txt"] },
        ],
        execPrefix: "",
      });

      expect(exec.exec).toHaveBeenCalledWith(
        "pip",
        ["install", "-r", "path with spaces/requirements.txt"],
        expect.anything(),
      );
    });

    it("should handle failure in Python commands gracefully throwing Error", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommand: "pip install -r requirements.txt",
          execPrefix: "",
        }),
      ).rejects.toThrow('Python command "pip install -r requirements.txt" failed. Check Python environment and dependency configuration.');

      expect(core.error).toHaveBeenCalledWith('Python command "pip install -r requirements.txt" failed');
    });

    it("should handle process launch errors gracefully when exec.exec rejects", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      vi.mocked(exec.exec).mockRejectedValueOnce(new Error("Unable to locate executable file: pip"));

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommand: "pip install -r requirements.txt",
          execPrefix: "",
        }),
      ).rejects.toThrow("Unable to locate executable file: pip");
    });
  });

  describe("package.json existence checks", () => {
    it("should skip and log when package.json does not exist", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      await run();

      expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
      expect(exec.exec).not.toHaveBeenCalled();
    });
  });

  describe("script execution routing", () => {
    const scriptCases = [
      {
        name: "check script priority",
        scripts: { check: "echo check", format: "echo format", lint: "echo lint" },
        expectedCalls: [["npm", ["run", "check"]]],
      },
      {
        name: "format and lint scripts",
        scripts: { format: "echo format", lint: "echo lint" },
        expectedCalls: [["npm", ["run", "format"]], ["npm", ["run", "lint"]]],
      },
      {
        name: "fmt and lint scripts when format is absent",
        scripts: { fmt: "echo fmt", lint: "echo lint" },
        expectedCalls: [["npm", ["run", "fmt"]], ["npm", ["run", "lint"]]],
      },
      {
        name: "format script only",
        scripts: { format: "echo format" },
        expectedCalls: [["npm", ["run", "format"]]],
      },
      {
        name: "fmt script only",
        scripts: { fmt: "echo fmt" },
        expectedCalls: [["npm", ["run", "fmt"]]],
      },
      {
        name: "lint script only",
        scripts: { lint: "echo lint" },
        expectedCalls: [["npm", ["run", "lint"]]],
      },
    ];

    it.each(scriptCases)("should select correct script(s) for $name", async ({ scripts, expectedCalls }) => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ scripts }) as any);

      await run();

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: process.cwd() }));
      for (const [cmd, args] of expectedCalls) {
        expect(exec.exec).toHaveBeenCalledWith(cmd, args, expect.objectContaining({ cwd: process.cwd() }));
      }
      expect(exec.exec).toHaveBeenCalledTimes(1 + expectedCalls.length);
    });

    it("should sanitize untrusted PACKAGE_MANAGER env values containing shell injection characters", async () => {
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

      await run();

      expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: process.cwd() }));
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: process.cwd() }));
      expect(exec.exec).toHaveBeenCalledTimes(2);
    });

    it("should log info and skip script execution when scripts are empty or no matched script exists", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            foo: "echo foo",
          },
        }) as any,
      );

      await run();

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: process.cwd() }));
      expect(exec.exec).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
    });

    it("should log info and skip script execution when scripts block is missing entirely in package.json", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ name: "my-package" }) as any);

      await run();

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: process.cwd() }));
      expect(exec.exec).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (check, format, lint, etc.) found in package.json.",
      );
    });
  });

  describe("package manager environmental options", () => {
    it("should respect custom PACKAGE_MANAGER env variable values such as pnpm", async () => {
      process.env.PACKAGE_MANAGER = "pnpm";
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo pnpm check",
          },
        }) as any,
      );

      await run();

      expect(core.info).toHaveBeenCalledWith("Executing: pnpm run check");
      expect(exec.exec).toHaveBeenCalledWith("pnpm", ["run", "check"], expect.objectContaining({ cwd: process.cwd() }));
    });

    it("should respect custom PACKAGE_MANAGER env variable values such as bun", async () => {
      process.env.PACKAGE_MANAGER = "bun";
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo bun check",
          },
        }) as any,
      );

      await run();

      expect(core.info).toHaveBeenCalledWith("Executing: bun run check");
      expect(exec.exec).toHaveBeenCalledWith("bun", ["run", "check"], expect.objectContaining({ cwd: process.cwd() }));
    });

    it("should fall back to npm if PACKAGE_MANAGER environment variable is undefined or blank", async () => {
      delete process.env.PACKAGE_MANAGER;
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "echo check",
          },
        }) as any,
      );

      await run();

      expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: process.cwd() }));
    });
  });

  describe("error and exception handling", () => {
    it("should set failed when package.json contains malformed JSON syntax", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue("{ invalid json syntax }" as any);

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Failed to run scripts: Failed to parse package.json:"),
      );
      expect(exec.exec).not.toHaveBeenCalled();
    });

    it("should set failed when package.json encounters a read/file access error", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("EACCES: permission denied, open 'package.json'");
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Failed to run scripts: Failed to read package.json: EACCES: permission denied"),
      );
    });

    it("should log an error and set workflow as failed if a script fails during execution", async () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("package.json"));
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({
          scripts: {
            check: "exit 1",
          },
        }) as any,
      );
      vi.mocked(exec.exec)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await run();

      expect(core.error).toHaveBeenCalledWith('Script "check" failed');
      expect(core.setFailed).toHaveBeenCalledWith(
        'Failed to run scripts: Script "check" failed while executing "npm run check".',
      );
    });
  });

  describe("Independent Workflow Execution & Scenario Matrix", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = path.join(
        originalCwd,
        "__tests__/fixtures/autofix/temp matrix dir " + Math.random().toString(36).substring(2, 9),
      );
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should succeed when both JS and Python workflows succeed in a mixed project", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should attempt Python workflow when JS workflow fails, and report action failure", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "exit 1" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockImplementation(async (cmd, args) => {
        if (cmd === "npm" && args?.[0] === "run") return 1;
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Script "check" failed while executing "npm run check".'),
      );
    });

    it("should complete JS workflow when Python workflow fails, and report action failure", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockImplementation(async (cmd, args) => {
        if (cmd === "ruff" && args?.[0] === "check") return 1;
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Ruff command "ruff check --fix ." failed.'),
      );
    });

    it("should attempt both workflows and aggregate error messages when both JS and Python workflows fail", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "exit 1" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockImplementation(async (cmd, args) => {
        if (cmd === "npm" && args?.[0] === "run") return 1;
        if (cmd === "ruff" && args?.[0] === "check") return 1;
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringMatching(
          /Failed to run scripts: Script "check" failed while executing "npm run check"\.\nRuff command "ruff check --fix \." failed\./,
        ),
      );
    });

    it("should perform JS dependency installation when package.json has no supported autofix script, and succeed if Python succeeds", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).not.toHaveBeenCalledWith("npm", ["run", expect.anything()], expect.anything());
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it("should skip JS workflow and attempt Python workflow when JS setup outcome is failure", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      process.env.JS_SETUP_OUTCOME = "failure";
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "echo check" } }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalledWith("npm", expect.anything(), expect.anything());
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("JavaScript runtime or package manager setup failed."),
      );
    });

    it("should run Python dependency installation and skip Ruff when Ruff setup outcome is failure but Python setup succeeds", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      process.env.RUFF_SETUP_OUTCOME = "failure";
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).not.toHaveBeenCalledWith("ruff", expect.anything(), expect.anything());
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Ruff setup failed."),
      );
    });

    it("should skip Python dependency setup and attempt Ruff when Python setup outcome is failure but Ruff setup succeeds", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      process.env.PY_SETUP_OUTCOME = "failure";
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalledWith("pip", expect.anything(), expect.anything());
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining("Python runtime or package manager setup failed."),
      );
    });

    it("should attempt Ruff execution even if Python dependency installation fails, and record both failures", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      vi.mocked(exec.exec).mockImplementation(async (executable) => {
        if (executable === "pip") return 1;
        if (executable === "ruff") return 1;
        return 0;
      });

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: tempDir }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: tempDir }));
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringMatching(
          /Failed to run scripts: Python command "pip install -r requirements\.txt" failed.*?\nRuff command "ruff check --fix \." failed/,
        ),
      );
    });

    it("should confirm action.yml enforces resolve_environment.outcome == success and sets setup outcome env vars", () => {
      const actionYmlPath = path.resolve(originalCwd, "autofix/action.yml");
      const actionYmlContent = fs.readFileSync(actionYmlPath, "utf8");

      expect(actionYmlContent).toContain("steps.resolve_environment.outcome == 'success'");
      expect(actionYmlContent).toContain("NODE_SETUP_OUTCOME:");
      expect(actionYmlContent).toContain("RUFF_SETUP_OUTCOME:");
    });
  });

  describe("File Safety", () => {
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

    it("should preserve existing user files and not perform destructive cleanups on failure", async () => {
      const userFile = path.join(tempDir, "unrelated-user-file.txt");
      fs.writeFileSync(userFile, "important user content");
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ scripts: { check: "exit 1" } }));

      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      await run(tempDir);

      expect(core.setFailed).toHaveBeenCalled();
      expect(fs.existsSync(userFile)).toBe(true);
      expect(fs.readFileSync(userFile, "utf8")).toBe("important user content");
    });
  });
});
