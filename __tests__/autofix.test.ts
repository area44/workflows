import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createConsumerProject } from "../.github/scripts/generate-consumer-project.js";
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
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-fixture-test-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const fixtureCases = [
      {
        action: "autofix",
        runtime: "node",
        pm: "npm",
        type: "basic",
        executable: "npm",
        installArgs: ["install"],
        expectedScriptNames: ["format", "lint"],
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "pnpm",
        type: "basic",
        executable: "pnpm",
        installArgs: ["install", "--no-frozen-lockfile"],
        expectedScriptNames: ["format", "lint"],
      },
      {
        action: "autofix",
        runtime: "bun",
        pm: "bun",
        type: "basic",
        executable: "bun",
        installArgs: ["install"],
        expectedScriptNames: ["format", "lint"],
      },
    ];

    it.each(fixtureCases)(
      "should install dependencies and run scripts for $pm basic scenario using @actions/exec",
      async ({ action, runtime, pm, type, executable, installArgs, expectedScriptNames }) => {
        const scenarioPath = path.join(tempDir, `${action}-${runtime}-${pm}-${type}`);
        createConsumerProject(scenarioPath, { action, runtime, pm, type });
        process.chdir(scenarioPath);
        process.env.PACKAGE_MANAGER = pm;

        await run();

        expect(exec.exec).toHaveBeenCalledWith(executable, installArgs, expect.objectContaining({ cwd: scenarioPath }));
        for (const scriptName of expectedScriptNames) {
          expect(exec.exec).toHaveBeenCalledWith(executable, ["run", scriptName], expect.objectContaining({ cwd: scenarioPath }));
        }
        expect(exec.exec).toHaveBeenCalledTimes(1 + expectedScriptNames.length);
      },
    );

    it("should not run Python workflow in JS/TS-only repository", async () => {
      const scenarioPath = path.join(tempDir, "js-only");
      createConsumerProject(scenarioPath, { action: "autofix", runtime: "node", pm: "npm", type: "basic" });
      process.chdir(scenarioPath);

      await run();

      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
      expect(exec.exec).not.toHaveBeenCalledWith(expect.stringMatching(/pip|uv/), expect.anything(), expect.anything());
    });
  });

  describe("Lockfile Updates & Mutation Invariants", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-lock-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should propagate non-zero exit code when ruff format fails after ruff check succeeds", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const ruffTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-ruff-fmt-"));
      fs.writeFileSync(path.join(ruffTempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockImplementation(async (_executable, args) => {
        if (args?.[0] === "format") return 1;
        return 0;
      });

      try {
        await expect(executeRuffAutofix(ruffTempDir)).rejects.toThrow('Ruff command "ruff format ." failed. Check Python and Ruff configuration.');
      } finally {
        fs.rmSync(ruffTempDir, { recursive: true, force: true });
      }
    });

    it("should handle uv sync failure during Python workflow execution", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const uvTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-uv-fail-"));
      fs.writeFileSync(path.join(uvTempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(uvTempDir, "pyproject.toml"), "[project]\nname = 'demo'\nversion = '0.1.0'\n");
      fs.writeFileSync(path.join(uvTempDir, "uv.lock"), "version = 1\n");

      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        if (executable === "uv" && args?.[0] === "sync") return 1;
        return 0;
      });

      try {
        await run(uvTempDir);

        expect(exec.exec).toHaveBeenCalledWith("uv", ["sync"], expect.objectContaining({ cwd: uvTempDir }));
        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringContaining('Python command "uv sync" failed.'),
        );
      } finally {
        fs.rmSync(uvTempDir, { recursive: true, force: true });
      }
    });

    it("should run Python workflow when Python source exists only under tests/ directory", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const testsTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-tests-only-"));
      fs.mkdirSync(path.join(testsTempDir, "tests"), { recursive: true });
      fs.writeFileSync(path.join(testsTempDir, "tests/test_foo.py"), "def test_foo(): pass\n");

      try {
        await run(testsTempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: testsTempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: testsTempDir }));
      } finally {
        fs.rmSync(testsTempDir, { recursive: true, force: true });
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
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-install-"));
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
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-python-test-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should execute Python workflow and Ruff autofix for uv fixture when Python source exists", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const scenarioPath = path.join(tempDir, "python-uv");
      createConsumerProject(scenarioPath, { type: "python-uv" });

      await run(scenarioPath);

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: uv");
      expect(exec.exec).toHaveBeenCalledWith("uv", ["sync"], expect.objectContaining({ cwd: scenarioPath }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: scenarioPath }));
      expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: scenarioPath }));
    });

    it("should install Python dependencies when executing Python workflow", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      await executePythonWorkflow(
        {
          name: "pip",
          installCommands: [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }],
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
          installCommands: [
            { executable: "pip", args: ["install", "-r", "requirements.txt"] },
            { executable: "pip", args: ["install", "-e", "."] },
          ],
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
            installCommands: [
              { executable: "pip", args: ["install", "-r", "requirements.txt"] },
              { executable: "pip", args: ["install", "-e", "."] },
            ],
            execPrefix: "",
          },
          originalCwd,
        ),
      ).rejects.toThrow('Python command "pip install -r requirements.txt" failed.');

      expect(exec.exec).toHaveBeenCalledTimes(1);
      expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.anything());
    });

    it("should skip lockfile sync and dependency installation for standalone Python projects", async () => {
      await executePythonWorkflow({
        name: "pip",
        installCommands: [],
        execPrefix: "",
        isStandalone: true,
      });

      expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      expect(exec.exec).not.toHaveBeenCalledWith("pip", expect.anything(), expect.anything());
    });

    it("should execute JS scripts, Python dependency setup, and Ruff in mixed-language projects in correct order", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const mixedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-mixed-"));
      fs.writeFileSync(path.join(mixedTempDir, "package.json"), JSON.stringify({ scripts: { check: "npm run check" } }));
      fs.writeFileSync(path.join(mixedTempDir, "main.py"), "print('mixed')\n");
      fs.writeFileSync(path.join(mixedTempDir, "requirements.txt"), "requests==2.31.0\n");

      try {
        await run(mixedTempDir);

        expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
        expect(exec.exec).toHaveBeenCalledWith("npm", ["run", "check"], expect.objectContaining({ cwd: mixedTempDir }));
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
        expect(exec.exec).toHaveBeenCalledWith("pip", ["install", "-r", "requirements.txt"], expect.objectContaining({ cwd: mixedTempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: mixedTempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: mixedTempDir }));
      } finally {
        fs.rmSync(mixedTempDir, { recursive: true, force: true });
      }
    });

    it("should run Ruff lint before Ruff format in Python repository", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const orderTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-order-"));
      fs.writeFileSync(path.join(orderTempDir, "main.py"), "print('hello')\n");

      const executedCommands: string[] = [];
      vi.mocked(exec.exec).mockImplementation(async (executable, args) => {
        executedCommands.push(`${executable} ${(args || []).join(" ")}`.trim());
        return 0;
      });

      try {
        await executeRuffAutofix(orderTempDir);

        expect(executedCommands).toEqual(["ruff check --fix .", "ruff format ."]);
      } finally {
        fs.rmSync(orderTempDir, { recursive: true, force: true });
      }
    });

    it("should not execute Ruff commands in a non-Python repository", async () => {
      const nonPyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-nonpy-"));
      fs.writeFileSync(path.join(nonPyTempDir, "README.md"), "# Hello");

      try {
        await executeRuffAutofix(nonPyTempDir);

        expect(exec.exec).not.toHaveBeenCalledWith("ruff", expect.anything(), expect.anything());
      } finally {
        fs.rmSync(nonPyTempDir, { recursive: true, force: true });
      }
    });

    it("should throw error when ruff executable is not available in PATH", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      const noRuffTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-noruff-"));
      fs.writeFileSync(path.join(noRuffTempDir, "main.py"), "print('hello')\n");

      try {
        await expect(executeRuffAutofix(noRuffTempDir)).rejects.toThrow("Required Python binary 'ruff' is not available in PATH.");
      } finally {
        fs.rmSync(noRuffTempDir, { recursive: true, force: true });
      }
    });

    it("should propagate non-zero ruff exit code as Error", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const ruffFailTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-ruff-fail-"));
      fs.writeFileSync(path.join(ruffFailTempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockResolvedValueOnce(1);

      try {
        await expect(executeRuffAutofix(ruffFailTempDir)).rejects.toThrow('Ruff command "ruff check --fix ." failed. Check Python and Ruff configuration.');
      } finally {
        fs.rmSync(ruffFailTempDir, { recursive: true, force: true });
      }
    });

    it("should execute Ruff in specified working directory", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);
      const cwdTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-cwd-"));
      fs.writeFileSync(path.join(cwdTempDir, "main.py"), "print('hello')\n");

      try {
        await executeRuffAutofix(cwdTempDir);

        expect(exec.exec).toHaveBeenCalledWith("ruff", ["check", "--fix", "."], expect.objectContaining({ cwd: cwdTempDir }));
        expect(exec.exec).toHaveBeenCalledWith("ruff", ["format", "."], expect.objectContaining({ cwd: cwdTempDir }));
      } finally {
        fs.rmSync(cwdTempDir, { recursive: true, force: true });
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
          installCommands: [{ executable: "uv", args: ["sync"] }],
          execPrefix: "uv run",
        }),
      ).rejects.toThrow("Required Python package manager 'uv' is not available in PATH.");

      expect(core.error).toHaveBeenCalledWith(
        "Required Python package manager 'uv' is not available in PATH.",
      );
      expect(exec.exec).not.toHaveBeenCalledWith("pip", expect.anything(), expect.anything());
    });

    it("should run Python workflow in Python-only repository without package.json when Python source exists", async () => {
      const pyOnlyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-pyonly-"));
      fs.writeFileSync(path.join(pyOnlyTempDir, "main.py"), "print('py-only')\n");

      try {
        await run(pyOnlyTempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).toHaveBeenCalledWith("Detected Python package manager: pip");
      } finally {
        fs.rmSync(pyOnlyTempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only pyproject.toml and no .py files", async () => {
      const pyprojectOnlyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-pyproj-"));
      fs.writeFileSync(path.join(pyprojectOnlyTempDir, "pyproject.toml"), "[project]\nname = 'demo'\n");

      try {
        await run(pyprojectOnlyTempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(exec.exec).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(pyprojectOnlyTempDir, { recursive: true, force: true });
      }
    });

    it("should not run Python workflow for repository with only [tool.ruff] configuration and no .py files", async () => {
      const toolRuffOnlyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-toolruff-"));
      fs.writeFileSync(path.join(toolRuffOnlyTempDir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n");

      try {
        await run(toolRuffOnlyTempDir);

        expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping scripts.");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Detected Python package manager"));
        expect(exec.exec).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(toolRuffOnlyTempDir, { recursive: true, force: true });
      }
    });

    it("should throw Error when pmInfo is null, non-object, or has unsupported package manager name", async () => {
      await expect(executePythonWorkflow(null as any)).rejects.toThrow(
        'Invalid Python environment: "pmInfo" must be an object',
      );

      await expect(executePythonWorkflow("pip" as any)).rejects.toThrow(
        'Invalid Python environment: "pmInfo" must be an object',
      );

      await expect(
        executePythonWorkflow({ name: "poetry", installCommands: [], execPrefix: "" } as any),
      ).rejects.toThrow('Invalid Python environment: pmInfo name must be "uv" or "pip"');
    });

    it("should throw Error when pmInfo.installCommands is missing or not an array", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);

      await expect(
        executePythonWorkflow({
          name: "pip",
          execPrefix: "",
        } as any),
      ).rejects.toThrow('Invalid Python environment: "pmInfo.installCommands" must be an array');

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommands: "pip install -r requirements.txt",
          execPrefix: "",
        } as any),
      ).rejects.toThrow('Invalid Python environment: "pmInfo.installCommands" must be an array');
    });

    it("should throw Error before execution when installCommands contains malformed item, blank executable, or non-string args", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommands: [{ executable: "", args: ["install"] }],
          execPrefix: "",
        }),
      ).rejects.toThrow('Invalid Python environment: malformed "installCommands" item');

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommands: [{ executable: "   ", args: ["install"] }],
          execPrefix: "",
        }),
      ).rejects.toThrow('Invalid Python environment: malformed "installCommands" item');

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommands: [{ executable: "pip", args: "install" as any }],
          execPrefix: "",
        }),
      ).rejects.toThrow('Invalid Python environment: malformed "installCommands" item');

      await expect(
        executePythonWorkflow({
          name: "pip",
          installCommands: [{ executable: "pip", args: [123 as any] }],
          execPrefix: "",
        }),
      ).rejects.toThrow('Invalid Python environment: malformed "installCommands" item');

      expect(exec.exec).not.toHaveBeenCalled();
    });

    it("should pass arguments containing spaces unchanged when structured PythonInstallCommand is used", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => `/usr/bin/${bin}`);

      await executePythonWorkflow({
        name: "pip",
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
          installCommands: [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }],
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
          installCommands: [{ executable: "pip", args: ["install", "-r", "requirements.txt"] }],
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
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-matrix-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should validate composite action contract structure, inputs, outputs, and execution guards in autofix/action.yml", () => {
      const actionYmlPath = path.resolve(originalCwd, "autofix/action.yml");
      const actionYmlContent = fs.readFileSync(actionYmlPath, "utf8");
      const action = YAML.parse(actionYmlContent);

      expect(action.name).toBe("Autofix");
      expect(action.runs.using).toBe("composite");

      // Inputs contract
      expect(action.inputs).toBeUndefined();

      // Outputs contract with exact expression mappings
      expect(action.outputs["javascript-detected"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-detected }}",
      );
      expect(action.outputs["javascript-runtime"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-runtime }}",
      );
      expect(action.outputs["javascript-runtime-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-runtime-version }}",
      );
      expect(action.outputs["javascript-package-manager"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-package-manager }}",
      );
      expect(action.outputs["javascript-package-manager-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.javascript-package-manager-version }}",
      );
      expect(action.outputs["python-detected"].value).toBe(
        "${{ steps.resolve_environment.outputs.python-detected }}",
      );
      expect(action.outputs["python-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.python-version }}",
      );
      expect(action.outputs["python-package-manager"].value).toBe(
        "${{ steps.resolve_environment.outputs.python-package-manager }}",
      );
      expect(action.outputs["ruff-version"].value).toBe(
        "${{ steps.resolve_environment.outputs.ruff-version }}",
      );

      // Steps
      const steps = action.runs.steps;
      expect(Array.isArray(steps)).toBe(true);

      const resolveEnvStep = steps.find((s: any) => s.id === "resolve_environment");
      expect(resolveEnvStep).toBeDefined();
      expect(resolveEnvStep.run).toContain('node "$ACTION_PATH/../dist/resolve-environment.mjs"');

      const setupUvStep = steps.find((s: any) => s.id === "setup_uv");
      expect(setupUvStep).toBeDefined();
      expect(setupUvStep.if).toContain("steps.resolve_environment.outputs.python-detected == 'true'");
      expect(setupUvStep.if).toContain("steps.resolve_environment.outputs.python-package-manager == 'uv'");

      const setupPyStep = steps.find((s: any) => s.id === "setup_python");
      expect(setupPyStep).toBeDefined();
      expect(setupPyStep.if).toContain("steps.resolve_environment.outputs.python-detected == 'true'");
      expect(setupPyStep.if).toContain("steps.resolve_environment.outputs.python-package-manager != 'uv'");

      const setupRuffStep = steps.find((s: any) => s.id === "setup_ruff");
      expect(setupRuffStep).toBeDefined();
      expect(setupRuffStep.if).toContain("steps.resolve_environment.outputs.python-detected == 'true'");

      const runAutofixStep = steps.find((s: any) => s.id === "run_autofix");
      expect(runAutofixStep).toBeDefined();
      expect(runAutofixStep.run).toContain('node "$ACTION_PATH/../dist/autofix.mjs"');
      expect(runAutofixStep.env).toHaveProperty("NODE_SETUP_OUTCOME");
      expect(runAutofixStep.env).toHaveProperty("BUN_SETUP_OUTCOME");
      expect(runAutofixStep.env).toHaveProperty("PNPM_SETUP_OUTCOME");
      expect(runAutofixStep.env).toHaveProperty("UV_SETUP_OUTCOME");
      expect(runAutofixStep.env).toHaveProperty("PY_SETUP_OUTCOME");
      expect(runAutofixStep.env).toHaveProperty("RUFF_SETUP_OUTCOME");

      const autofixCiStep = steps.find((s: any) => s.uses?.startsWith("autofix-ci/action"));
      expect(autofixCiStep).toBeDefined();
      expect(autofixCiStep.if).toContain("github.workflow == 'autofix.ci'");
      expect(autofixCiStep.if).toContain("steps.run_autofix.outcome == 'success'");

      // Verify referenced dist entrypoint files exist on disk
      expect(fs.existsSync(path.resolve(originalCwd, "dist/resolve-environment.mjs"))).toBe(true);
      expect(fs.existsSync(path.resolve(originalCwd, "dist/autofix.mjs"))).toBe(true);
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
  });

  describe("File Safety", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflows-autofix-safety-"));
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
