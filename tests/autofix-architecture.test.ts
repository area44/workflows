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

    it("rejects false positives from strings inside echo or comments in doesFixScriptDelegateTo", () => {
      const scripts = {
        fix: 'echo "&& npm run format:write;" && npm run lint:fix',
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      // "format:write" was inside quotes in echo, so fix does NOT delegate to format:write!
      expect(tasks.map((t) => t.scriptName)).toEqual(["fix", "format:write"]);
    });

    it("recognizes delegation when URL fragments or ordinary words contain '#' characters", () => {
      // Case A: URL fragment
      const scriptsUrl = {
        fix: "echo https://example.com/#fragment && npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasksUrl = resolveScriptTasks(scriptsUrl, "fix");
      expect(tasksUrl.map((t) => t.scriptName)).toEqual(["fix"]);

      // Case B: Hash inside ordinary word
      const scriptsWord = {
        fix: "echo value#fragment && npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasksWord = resolveScriptTasks(scriptsWord, "fix");
      expect(tasksWord.map((t) => t.scriptName)).toEqual(["fix"]);

      const scriptsPath = {
        fix: "echo path/to/file#section && npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasksPath = resolveScriptTasks(scriptsPath, "fix");
      expect(tasksPath.map((t) => t.scriptName)).toEqual(["fix"]);
    });

    it("properly handles actual shell comments and commented-out delegations", () => {
      // Case C: Actual shell comments
      // echo hello # npm run format:write\nnpm run lint:fix
      const scriptsComment = {
        fix: "echo hello # npm run format:write\nnpm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasksComment = resolveScriptTasks(scriptsComment, "fix");
      // The format:write delegation is commented out, so format:write must NOT be suppressed by fix!
      // But lint:fix is on the next line and is executed by fix, so lint:fix is suppressed.
      expect(tasksComment.map((t) => t.scriptName)).toEqual(["fix", "format:write"]);

      const scriptsCommentStart = {
        fix: "echo hello\n# npm run format:write\nnpm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasksCommentStart = resolveScriptTasks(scriptsCommentStart, "fix");
      expect(tasksCommentStart.map((t) => t.scriptName)).toEqual(["fix", "format:write"]);
    });

    it("handles hashes inside quoted strings and escaped hashes", () => {
      // Case D: Hash inside quotes
      const scriptsQuotedHash = {
        fix: 'echo "# npm run format:write" && npm run lint:fix',
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasksQuotedHash = resolveScriptTasks(scriptsQuotedHash, "fix");
      expect(tasksQuotedHash.map((t) => t.scriptName)).toEqual(["fix", "format:write"]);

      const scriptsSingleQuoteHash = {
        fix: "echo 'value#fragment' && npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasksSingleQuote = resolveScriptTasks(scriptsSingleQuoteHash, "fix");
      expect(tasksSingleQuote.map((t) => t.scriptName)).toEqual(["fix"]);

      // Case E: Escaped hash
      const scriptsEscapedHash = {
        fix: "echo \\#fragment && npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasksEscaped = resolveScriptTasks(scriptsEscapedHash, "fix");
      expect(tasksEscaped.map((t) => t.scriptName)).toEqual(["fix"]);
    });

    it("recognizes package manager delegations with single and double-quoted script arguments and executables", () => {
      // npm run "format:write"
      expect(
        resolveScriptTasks(
          {
            fix: 'npm run "format:write"',
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // npm run 'format:write'
      expect(
        resolveScriptTasks(
          {
            fix: "npm run 'format:write'",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // pnpm run "lint:fix"
      expect(
        resolveScriptTasks(
          {
            fix: 'pnpm run "lint:fix"',
            "lint:fix": "eslint --fix .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // bun run 'format:write'
      expect(
        resolveScriptTasks(
          {
            fix: "bun run 'format:write'",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // yarn run "lint:fix"
      expect(
        resolveScriptTasks(
          {
            fix: 'yarn run "lint:fix"',
            "lint:fix": "eslint --fix .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Quoted executable name: "npm" run "format:write"
      expect(
        resolveScriptTasks(
          {
            fix: '"npm" run "format:write"',
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Environment assignments with quoted script argument
      expect(
        resolveScriptTasks(
          {
            fix: 'NODE_ENV=production npm run "format:write"',
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Multiple commands with quotes: npm run "format:write" && npm run "lint:fix"
      expect(
        resolveScriptTasks(
          {
            fix: 'npm run "format:write" && npm run "lint:fix"',
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);
    });

    it("does not false-positive on quotes inside echo, printf, or malformed input", () => {
      // echo "npm run format:write"
      expect(
        resolveScriptTasks(
          {
            fix: 'echo "npm run format:write"',
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);

      // echo 'npm run format:write'
      expect(
        resolveScriptTasks(
          {
            fix: "echo 'npm run format:write'",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);

      // printf '%s' "npm run format:write"
      expect(
        resolveScriptTasks(
          {
            fix: "printf '%s' \"npm run format:write\"",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);
    });

    it("recognizes package manager delegations preceded by valid environment variable assignments", () => {
      // Single environment assignment before npm run
      expect(
        resolveScriptTasks(
          {
            fix: "NODE_ENV=production npm run format:write",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Multiple environment assignments before pnpm run
      expect(
        resolveScriptTasks(
          {
            fix: "NODE_ENV=production CI=true pnpm run format:write",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Environment assignments before bun run
      expect(
        resolveScriptTasks(
          {
            fix: "DEBUG=1 bun run format:write",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Environment assignment before lint autofix script
      expect(
        resolveScriptTasks(
          {
            fix: "CI=true npm run lint:fix",
            "lint:fix": "eslint --fix .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Direct package-manager aliases with env assignments: pnpm format, bun format, yarn format
      expect(
        resolveScriptTasks(
          {
            fix: "FOO=bar pnpm format:write",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);

      // Chained commands where one has an environment assignment
      expect(
        resolveScriptTasks(
          {
            fix: "NODE_ENV=production npm run format:write && npm run lint:fix",
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]);
    });

    it("does not false-positive on assignments after executable, echo arguments, or quoted commands", () => {
      // Assignment appearing after executable (an argument, not an assignment prefix)
      expect(
        resolveScriptTasks(
          {
            fix: "npm run format:write NODE_ENV=production",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix"]); // Still delegates to format:write because npm run format:write is the prefix!

      // Assignment-looking text passed to echo
      expect(
        resolveScriptTasks(
          {
            fix: "echo NODE_ENV=production",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);

      // Environment assignment preceding non-package-manager command with quoted command string
      expect(
        resolveScriptTasks(
          {
            fix: 'NODE_ENV=production echo "npm run format:write"',
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);

      // Environment assignment followed by an unrelated command
      expect(
        resolveScriptTasks(
          {
            fix: "NODE_ENV=production run-custom-task",
            "format:write": "prettier --write .",
          },
          "fix",
        ).map((t) => t.scriptName),
      ).toEqual(["fix", "format:write"]);
    });

    it("verifies planner integration with environment-assignment delegation", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "NODE_ENV=production npm run format:write && npm run lint:fix",
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");

      // Because 'fix' delegates to both format:write and lint:fix, only 'fix' should be scheduled
      expect(plan.tasks.map((t) => t.id)).toEqual(["script-fix"]);
    });

    it("verifies planner integration with URL fragment vs commented-out delegation", async () => {
      // 1. URL fragment before real delegation: planner schedules ONLY fix, not format:write
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "echo https://example.com/#fragment && npm run format:write",
            "format:write": "prettier --write .",
          },
        }),
      );

      const registry = createDefaultRegistry();
      const planDelegated = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planDelegated.tasks.map((t) => t.id)).toEqual(["script-fix"]);

      // 2. Commented out delegation: planner schedules BOTH fix and format:write
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "echo hello # npm run format:write\nexit 0",
            "format:write": "prettier --write .",
          },
        }),
      );

      const planCommented = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCommented.tasks.map((t) => t.id)).toEqual(["script-fix", "script-format:write"]);
    });

    it("handles Biome partial capability resolution and preserves assist actions", async () => {
      const binDir = path.join(tempDir, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, "prettier"), "");
      fs.chmodSync(path.join(binDir, "prettier"), "755");
      fs.writeFileSync(path.join(binDir, "biome"), "");
      fs.chmodSync(path.join(binDir, "biome"), "755");
      fs.writeFileSync(path.join(binDir, "eslint"), "");
      fs.chmodSync(path.join(binDir, "eslint"), "755");

      // Formatting covered by explicit script: format is skipped while Biome lint and assist actions run
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");

      const registry = createDefaultRegistry();
      const planFormatCovered = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFormatCovered.tasks.map((t) => t.id)).toEqual([
        "script-format:write",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // Fix script delegating only to format: only covers format, so Biome lint and assist remain
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "npm run format:write",
            "format:write": "prettier --write .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );
      const planFixFormatOnly = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFixFormatOnly.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);
      expect(planFixFormatOnly.tasks[0].capability).toBe("format");

      // Fix script delegating only to lint: only covers lint, so Biome format and assist remain
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "npm run lint:fix",
            "lint:fix": "eslint --fix .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );
      const planFixLintOnly = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFixLintOnly.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-assist-fix",
      ]);
      expect(planFixLintOnly.tasks[0].capability).toBe("lint");

      // Fix script delegating to both format and lint: Biome format and lint skipped, but Assist remains
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "npm run format:write && npm run lint:fix",
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );
      const planFixBoth = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFixBoth.tasks.map((t) => t.id)).toEqual(["script-fix", "biome-assist-fix"]);

      // Linting covered by explicit script: lint is skipped while Biome format and assist actions run
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "lint:fix": "eslint --fix .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planLintCovered = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planLintCovered.tasks.map((t) => t.id)).toEqual([
        "script-lint:fix",
        "biome-format-fix",
        "biome-assist-fix",
      ]);

      // Both formatting and linting covered by explicit scripts: format and lint from Biome are skipped, but Assist remains
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planBothCovered = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planBothCovered.tasks.map((t) => t.id)).toEqual([
        "script-format:write",
        "script-lint:fix",
        "biome-assist-fix",
      ]);
      const assistTask = planBothCovered.tasks.find((t) => t.id === "biome-assist-fix");
      expect(assistTask?.capability).toBe("assist");
      expect(assistTask?.args).toEqual([
        "check",
        "--write",
        "--formatter-enabled=false",
        "--linter-enabled=false",
        ".",
      ]);

      // Generic fix script covers autofix, formatting, and linting: all Biome tasks skipped
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "custom-fix-all",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planGenericFix = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planGenericFix.tasks.map((t) => t.id)).toEqual(["script-fix"]);

      // Neither covered: Biome schedules format, lint, and assist actions
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planNeitherCovered = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planNeitherCovered.tasks.map((t) => t.id)).toEqual([
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // Check mode: schedules check commands without --write
      const planCheckMode = await planExecution(registry, { cwd: tempDir }, "check");
      expect(planCheckMode.tasks.map((t) => t.id)).toEqual([
        "biome-format-check",
        "biome-lint-check",
        "biome-assist-check",
      ]);
      expect(planCheckMode.tasks.every((t) => t.mode === "check")).toBe(true);

      // Deterministic ordering across repeated runs
      const planRepeat1 = await planExecution(registry, { cwd: tempDir }, "fix");
      const planRepeat2 = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planRepeat1.tasks.map((t) => t.id)).toEqual(planRepeat2.tasks.map((t) => t.id));
    });

    it("verifies check-mode and fix-mode detection consistency in JavaScriptScriptAdapter", async () => {
      // Check-only project
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:check": "prettier --check .",
            "lint:check": "eslint .",
          },
        }),
      );

      const registry = createDefaultRegistry();
      const planCheck = await planExecution(registry, { cwd: tempDir }, "check");
      expect(planCheck.tasks.map((t) => t.id)).toEqual([
        "script-format:check",
        "script-lint:check",
      ]);

      const planFix = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFix.tasks).toEqual([]);

      // Fix-only project
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );

      const planFixOnly = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planFixOnly.tasks.map((t) => t.id)).toEqual([
        "script-format:write",
        "script-lint:fix",
      ]);

      const planCheckOnly = await planExecution(registry, { cwd: tempDir }, "check");
      expect(planCheckOnly.tasks).toEqual([]);

      // Check mode safety: format alone or fmt alone is never scheduled in check mode
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            format: "prettier --write .",
            fmt: "prettier --write .",
          },
        }),
      );

      const planFormatWriteOnly = await planExecution(registry, { cwd: tempDir }, "check");
      expect(planFormatWriteOnly.tasks).toEqual([]);

      // Check mode safely selects format:check or fmt:check
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:check": "prettier --check .",
            format: "prettier --write .",
          },
        }),
      );

      const planExplicitCheck = await planExecution(registry, { cwd: tempDir }, "check");
      expect(planExplicitCheck.tasks.map((t) => t.id)).toEqual(["script-format:check"]);
    });

    it("evaluates Python detection accurately when planExecution receives { cwd } without precomputed hasPythonSource", async () => {
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");

      expect(plan.tasks.some((t) => t.toolId === "ruff")).toBe(true);
      expect(plan.selectedTools.some((t) => t.id === "ruff")).toBe(true);
      expect(plan.summary).toContain("Python: true");
      expect(plan.summary).toContain("Ruff: default tool");
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
      vi.spyOn(io, "which").mockResolvedValue("/usr/bin/cargo");
      const results = await engine.executeTasks(plan.tasks);
      expect(results).toHaveLength(1);
      expect(results[0].exitCode).toBe(0);
      expect(exec.exec).toHaveBeenCalledWith(
        "/usr/bin/cargo",
        ["fmt"],
        expect.objectContaining({ cwd: tempDir }),
      );
    });
  });
});
