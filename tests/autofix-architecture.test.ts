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

import { ExecutionEngine } from "../src/autofix/engine.js";
import { run } from "../src/autofix/index.js";
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

  describe("JavaScript/TypeScript: Hybrid Detection & Precedence", () => {
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

    it("does NOT execute 'check', 'test', or 'typecheck' scripts as autofix commands in fix mode", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            check: "tsc --noEmit",
            test: "vitest run",
            typecheck: "tsc",
          },
        }),
      );

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (fix, format, lint, check, etc.) found in package.json.",
      );
    });
  });

  describe("Tool Adapters Detection & Safety", () => {
    it("detects Prettier when dependency AND configuration file exist, executing tool directly if scripts absent", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/prettier");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc.json"), "{}");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "prettier",
        ["--write", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("does NOT execute Prettier if installed as dependency without configuration", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { prettier: "^3.0.0" },
        }),
      );

      await run(tempDir);

      expect(exec.exec).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(
        "No matching scripts (fix, format, lint, check, etc.) found in package.json.",
      );
    });

    it("detects ESLint when dependency and configuration file exist", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/eslint");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { eslint: "^9.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "eslint.config.js"), "export default [];\n");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "eslint",
        ["--fix", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("detects Biome when dependency and biome.json exist", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/biome");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { "@biomejs/biome": "^1.8.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "biome",
        ["check", "--write", "."],
        expect.objectContaining({ cwd: tempDir }),
      );
    });

    it("resolves conflicts deterministically: explicit script suppresses inferred tool adapters", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/prettier");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            format: "custom-fmt .",
          },
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      await run(tempDir);

      expect(exec.exec).toHaveBeenCalledWith(
        "npm",
        ["run", "format"],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(exec.exec).not.toHaveBeenCalledWith("prettier", expect.anything(), expect.anything());
    });

    it("resolves conflicts deterministically: Biome covers format + lint and skips Prettier & ESLint", async () => {
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/biome");
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: {
            "@biomejs/biome": "^1.8.0",
            prettier: "^3.0.0",
            eslint: "^9.0.0",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");
      fs.writeFileSync(path.join(tempDir, "eslint.config.js"), "export default [];");

      const registry = createDefaultRegistry();
      const plan = await planExecution(
        registry,
        {
          cwd: tempDir,
          jsEnv: {
            hasPackageJson: true,
            packageJson: {
              devDependencies: {
                "@biomejs/biome": "^1.8.0",
                prettier: "^3.0.0",
                eslint: "^9.0.0",
              },
            },
            hasBunVersionFile: false,
            hasNodeVersionFile: false,
            hasPnpmLock: false,
            hasPackageLock: true,
            hasBunLock: false,
          },
          jsPm: "npm",
        },
        "fix",
      );

      expect(plan.selectedTools.map((t) => t.id)).toContain("biome");
      expect(plan.skippedTools.map((t) => t.id)).toContain("prettier");
      expect(plan.skippedTools.map((t) => t.id)).toContain("eslint");
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].executable).toBe("biome");
    });
  });

  describe("Explainable Execution Plan", () => {
    it("produces structured and human-readable execution plan summary", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "script.py"), "print('hello')\n");
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/ruff");

      const registry = createDefaultRegistry();
      const plan = await planExecution(
        registry,
        {
          cwd: tempDir,
          hasPythonSource: true,
          jsEnv: {
            hasPackageJson: true,
            packageJson: {
              scripts: {
                "format:write": "prettier --write .",
                "lint:fix": "eslint --fix .",
              },
            },
            hasBunVersionFile: false,
            hasNodeVersionFile: false,
            hasPnpmLock: false,
            hasPackageLock: true,
            hasBunLock: false,
          },
          jsPm: "npm",
        },
        "fix",
      );

      expect(plan.summary).toContain("Detected environments:");
      expect(plan.summary).toContain("Python: true");
      expect(plan.summary).toContain("JavaScript: true");
      expect(plan.summary).toContain("Ruff: default tool");
      expect(plan.summary).toContain("Execution plan:");
      expect(plan.summary).toContain("Ruff: lint autofix");
      expect(plan.summary).toContain("Ruff: format");
      expect(plan.summary).toContain("package.json scripts: selected");
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
