import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  ExecutionMode,
  ExecutionTask,
  LanguageProvider,
  ProjectContext,
  ToolAdapter,
} from "../src/autofix/types.js";

import { resolveScriptTasks } from "../src/autofix/adapters/javascript/script-adapter.js";
import { ExecutionEngine } from "../src/autofix/engine.js";
import { executeJsWorkflow, run } from "../src/autofix/index.js";
import { planExecution } from "../src/autofix/planner.js";
import { AutofixRegistry, createDefaultRegistry } from "../src/autofix/registry.js";

vi.mock("@actions/exec");
vi.mock("@actions/core");
vi.mock("@actions/io");

describe("Refactored Autofix Architecture & Tool Adapters", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(exec.exec).mockReset();
    vi.mocked(exec.exec).mockResolvedValue(0);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-arch-test-"));
    process.chdir(tempDir);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Python: Ruff as Default Toolchain", () => {
    it("activates Ruff when Python source is detected, even without pyproject.toml, lockfiles, or scripts", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");
      fs.writeFileSync(path.join(tempDir, "script.py"), "print('hello')\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "ruff",
        ["check", "--fix", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "ruff",
        ["format", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("does not install Ruff through uv or pip, preserving astral-sh/ruff-action provisioning", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");
      fs.writeFileSync(path.join(tempDir, "script.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalledWith(
        "pip",
        expect.arrayContaining(["install", "ruff"]),
        expect.anything(),
      );
      expect(exec.exec).not.toHaveBeenCalledWith(
        "uv",
        expect.arrayContaining(["add", "ruff"]),
        expect.anything(),
      );
    });

    it("keeps lint and format as separate capabilities in plan", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");
      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir, hasPythonSource: true }, "fix");

      const ruffTasks = plan.tasks.filter((t) => t.toolId === "ruff");
      expect(ruffTasks).toHaveLength(2);
      expect(ruffTasks[0].capability).toBe("lint");
      expect(ruffTasks[0].args).toEqual(["check", "--fix", "."]);
      expect(ruffTasks[1].capability).toBe("format");
      expect(ruffTasks[1].args).toEqual(["format", "."]);
    });
  });

  describe("JavaScript/TypeScript: Hybrid Detection & Script Precedence", () => {
    it("respects explicit script conventions: 'check:fix' as combined autofix", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "check:fix": "biome check --write .",
          },
        }),
      );

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "check:fix"],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("respects explicit script conventions: 'format:write' and 'lint:fix'", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "format:write"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "lint:fix"],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("does NOT execute 'check', 'test', 'typecheck', 'lint', or 'lint:check' as autofix commands in fix mode", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            check: "tsc --noEmit",
            test: "vitest run",
            typecheck: "tsc",
            lint: "eslint .",
            "lint:check": "eslint .",
          },
        }),
      );

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (fix, format, lint, check, etc.) found in package.json.",
      );
    });

    it("generic 'fix' does not suppress independent 'format:write' and 'lint:fix' scripts", async () => {
      const scripts = {
        fix: "custom-fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks.map((t) => t.scriptName)).toEqual(["fix", "format:write", "lint:fix"]);
    });

    it("generic 'fix' suppresses independent format script if fix explicitly calls format", async () => {
      const scripts = {
        fix: "npm run format && npm run lint:fix",
        format: "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks.map((t) => t.scriptName)).toEqual(["fix"]);
    });

    it("distinguishes fix mode and check mode for lint scripts", () => {
      expect(resolveScriptTasks({ "lint:check": "eslint ." }, "fix")).toEqual([]);
      expect(resolveScriptTasks({ lint: "eslint ." }, "fix")).toEqual([]);
      expect(resolveScriptTasks({ "lint:check": "eslint ." }, "check")).toEqual([
        { capability: "lint", scriptName: "lint:check" },
      ]);
      expect(resolveScriptTasks({ lint: "eslint ." }, "check")).toEqual([
        { capability: "lint", scriptName: "lint" },
      ]);
      expect(resolveScriptTasks({ "lint:fix": "eslint --fix ." }, "fix")).toEqual([
        { capability: "lint", scriptName: "lint:fix" },
      ]);
      expect(resolveScriptTasks({ "lint:write": "eslint --fix ." }, "fix")).toEqual([
        { capability: "lint", scriptName: "lint:write" },
      ]);
    });
  });

  describe("Tool Adapters & Safe Executable Resolution", () => {
    it("detects Prettier when dependency AND configuration file exist, executing via local project binary", async () => {
      const binDir = path.join(tempDir, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, "prettier"), "");
      fs.chmodSync(path.join(binDir, "prettier"), "755");

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc.json"), "{}");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        path.join(binDir, "prettier"),
        ["--write", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("throws actionable error when tool is configured but its executable cannot be found", async () => {
      vi.spyOn(io, "which").mockResolvedValue("");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc.json"), "{}");

      await expect(executeJsWorkflow(tempDir)).rejects.toThrow(
        /Configured tool "Prettier" could not run: executable "prettier" is not available/,
      );
    });

    it("Vite+ in fix mode executes vp fmt and vp lint --fix rather than check --fix", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => {
        if (bin === "vp") return "/usr/local/bin/vp";
        return "";
      });

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { "vite-plus": "^1.4.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "/usr/local/bin/vp",
        ["fmt"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "/usr/local/bin/vp",
        ["lint", "--fix"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(["check", "--fix"]),
        expect.anything(),
      );
    });

    it("resolves capabilities dynamically: 'format:write' script allows ESLint tool detection to run lint", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => {
        if (bin === "eslint") return "/usr/local/bin/eslint";
        return "";
      });

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
          devDependencies: { eslint: "^9.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "eslint.config.js"), "export default [];");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "format:write"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "/usr/local/bin/eslint",
        ["--fix", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("resolves capabilities dynamically: 'format:write' script + Vite+ runs Vite+ lint while skipping Vite+ fmt", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => {
        if (bin === "vp") return "/usr/local/bin/vp";
        return "";
      });

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
          devDependencies: { "vite-plus": "^1.4.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "format:write"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).toHaveBeenCalledWith(
        "/usr/local/bin/vp",
        ["lint", "--fix"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).not.toHaveBeenCalledWith("/usr/local/bin/vp", ["fmt"], expect.anything());
    });
  });

  describe("Error Aggregation Across Multiple Failures", () => {
    it("aggregates errors when multiple independent JS and Python tasks fail", async () => {
      vi.spyOn(io, "which").mockImplementation(async (bin) => {
        if (bin === "ruff") return "/usr/bin/ruff";
        return "";
      });

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "lint:fix": "exit 1",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      vi.mocked(exec.exec).mockImplementation(async (cmd, args) => {
        if (cmd === "npm" && args?.[0] === "run") return 1;
        if (cmd === "ruff" && args?.[0] === "check") return 1;
        return 0;
      });

      await run(tempDir);

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringMatching(
          /Failed to run scripts: Script "lint:fix" failed while executing "npm run lint:fix"\.\nRuff command "ruff check --fix \." failed\./,
        ),
      );
    });
  });

  describe("Registry Extensibility", () => {
    it("allows adding a new language provider and tool adapter without modifying the core orchestrator", async () => {
      const registry = new AutofixRegistry();

      class MockRustAdapter implements ToolAdapter {
        id = "rustfmt";
        name = "rustfmt";
        capabilities: ["format"] = ["format"];
        detect() {
          return { detected: true, reason: "rustfmt.toml detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "rustfmt",
              toolId: this.id,
              capability: "format",
              executable: "cargo",
              args: ["fmt"],
              cwd: ctx.cwd,
              mode,
              description: "cargo fmt",
            },
          ];
        }
      }

      class MockRustProvider implements LanguageProvider {
        id = "rust";
        name = "Rust";
        detect(_context: ProjectContext) {
          return true;
        }
        getAdapters(_context: ProjectContext) {
          return [new MockRustAdapter()];
        }
      }

      registry.registerProvider(new MockRustProvider());

      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools[0].id).toBe("rustfmt");
      expect(plan.tasks[0].executable).toBe("cargo");
      expect(plan.tasks[0].args).toEqual(["fmt"]);

      const engine = new ExecutionEngine();
      vi.mocked(exec.exec).mockResolvedValue(0);
      const results = await engine.executeTasks(plan.tasks);
      expect(results).toHaveLength(1);
      expect(results[0].exitCode).toBe(0);
      expect(exec.exec).toHaveBeenCalledWith(
        "cargo",
        ["fmt"],
        expect.objectContaining({ cwd: tempDir }),
      );
    });
  });
});
