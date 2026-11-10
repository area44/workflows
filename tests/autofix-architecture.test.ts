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

import {
  classifyScript,
  resolveScriptTasks,
} from "../src/autofix/adapters/javascript/script-adapter.js";
import { ExecutionEngine, resolveProjectBinary } from "../src/autofix/engine.js";
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

      // Generic fix script that runs full check (e.g. biome check --write) legitimately covers autofix: all Biome tasks skipped
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "biome check --write .",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planGenericFix = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planGenericFix.tasks.map((t) => t.id)).toEqual(["script-fix"]);

      // Unknown custom fix script does NOT overclaim autofix and does NOT suppress Biome tasks
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "custom-fix-all",
          },
          devDependencies: { "@biomejs/biome": "^1.9.0" },
        }),
      );

      const planUnknownCustomFix = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planUnknownCustomFix.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

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

      // Check mode safety: lint scripts containing write flags (--fix, --write) are rejected in check mode
      expect(resolveScriptTasks({ lint: "eslint . --fix" }, "check")).toEqual([]);
      expect(resolveScriptTasks({ lint: "biome check --write ." }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "lint:check": "eslint . --fix" }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "lint:check": "eslint . --fix=somewhere" }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "format:check": "prettier --write ." }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "format:check": "prettier -w ." }, "check")).toEqual([]);
      expect(
        resolveScriptTasks({ "format:check": "prettier --write=somewhere ." }, "check"),
      ).toEqual([]);
      expect(resolveScriptTasks({ "fmt:check": "prettier --write ." }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "fmt:check": "prettier -w ." }, "check")).toEqual([]);
      expect(resolveScriptTasks({ lint: "eslint . --fix" }, "fix")).toEqual([]); // Not a recognized fix alias
      expect(resolveScriptTasks({ "lint:fix": "eslint . --fix" }, "fix")).toEqual([
        { capability: "lint", scriptName: "lint:fix" },
      ]);
    });

    it("verifies formatter selection in fix mode rejects read-only format scripts", () => {
      // "format: "prettier --check ."" is read-only and must NOT be selected as format write
      expect(resolveScriptTasks({ format: "prettier --check ." }, "fix")).toEqual([]);
      expect(resolveScriptTasks({ fmt: "prettier --check ." }, "fix")).toEqual([]);

      // "format: "prettier --write ."" is write-capable and is selected as format write
      expect(resolveScriptTasks({ format: "prettier --write ." }, "fix")).toEqual([
        { capability: "format", scriptName: "format" },
      ]);
      expect(resolveScriptTasks({ fmt: "prettier -w ." }, "fix")).toEqual([
        { capability: "format", scriptName: "fmt" },
      ]);
      expect(resolveScriptTasks({ "format:write": "prettier --write ." }, "fix")).toEqual([
        { capability: "format", scriptName: "format:write" },
      ]);
      expect(resolveScriptTasks({ "format:fix": "prettier --write ." }, "fix")).toEqual([
        { capability: "format", scriptName: "format:fix" },
      ]);
    });

    it("verifies command-aware capability detection rejects tool names in echo or comments", async () => {
      // echo prettier --write .
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "echo prettier --write .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");

      const registry = createDefaultRegistry();
      const planEchoPrettier = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planEchoPrettier.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // echo "eslint . --fix"
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: 'echo "eslint . --fix"',
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      const planEchoEslint = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planEchoEslint.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // Real tool invocation after &&
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "echo starting && prettier --write .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      const planChained = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planChained.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);
      expect(planChained.tasks[0].capability).toBe("format");

      // Real tool invocation after ;
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "echo hello; eslint . --fix",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      const planSemicolon = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planSemicolon.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-assist-fix",
      ]);
      expect(planSemicolon.tasks[0].capability).toBe("lint");
    });

    it("verifies direct tool fix script capability assignment without overclaiming", async () => {
      // Read-only "prettier ." does not claim formatting write capability
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "prettier .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");

      const registry = createDefaultRegistry();
      const planReadOnlyPrettier = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planReadOnlyPrettier.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // Read-only "eslint ." does not claim lint write capability
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "eslint .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );
      const planReadOnlyEslint = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planReadOnlyEslint.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // fix: "prettier --write ." claims format and does not suppress Biome lint or Assist tasks
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "prettier --write .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );

      const planPrettier = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planPrettier.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);
      expect(planPrettier.tasks[0].capability).toBe("format");

      // fix: "eslint --fix ." claims lint and does not suppress Biome format or Assist tasks
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "eslint --fix .",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );

      const planEslint = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planEslint.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-assist-fix",
      ]);
      expect(planEslint.tasks[0].capability).toBe("lint");

      // fix: "vp fmt" only claims format and does not suppress Biome lint or Assist tasks
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "vp fmt",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );

      const planVpFmt = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planVpFmt.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);
      expect(planVpFmt.tasks[0].capability).toBe("format");

      // fix: "vp lint" without --fix is read-only and does not claim lint write
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "vp lint",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );

      const planVpLintReadOnly = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planVpLintReadOnly.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-lint-fix",
        "biome-assist-fix",
      ]);

      // fix: "vp lint --fix" only claims lint and does not suppress Biome format or Assist tasks
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "vp lint --fix",
          },
          devDependencies: { "@biomejs/biome": "^2.0.0" },
        }),
      );

      const planVpLintFix = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planVpLintFix.tasks.map((t) => t.id)).toEqual([
        "script-fix",
        "biome-format-fix",
        "biome-assist-fix",
      ]);
      expect(planVpLintFix.tasks[0].capability).toBe("lint");
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

  describe("Check-Mode Safety & Formatter Detection Regressions", () => {
    it("rejects unknown commands and unsupported shell wrappers in check mode", () => {
      expect(classifyScript("node scripts/format.js")).toBe("unknown");
      expect(classifyScript("make lint")).toBe("unknown");
      expect(classifyScript("python -m lint")).toBe("unknown");
      expect(classifyScript("zsh -c 'prettier --check .'")).toBe("unknown");

      // In check mode, resolveScriptTasks rejects unknown commands for all check conventions
      const checkTasks = resolveScriptTasks(
        {
          "format:check": "node scripts/format.js",
          "fmt:check": "make fmt",
          "lint:check": "python -m lint",
          lint: "make lint",
        },
        "check",
      );
      expect(checkTasks).toEqual([]);
    });

    it("handles unresolved package-manager delegations, nested delegations, and delegation cycles", () => {
      // Unresolved delegation
      expect(
        classifyScript("npm run missing-script", {
          "other-script": "prettier --check .",
        }),
      ).toBe("unknown");

      // Nested delegation to verified read-only command
      expect(
        classifyScript("npm run check:fmt", {
          "check:fmt": "pnpm run verify:prettier",
          "verify:prettier": "prettier --check .",
        }),
      ).toBe("read-only");

      // Nested delegation to write-capable command
      expect(
        classifyScript("npm run check:fmt", {
          "check:fmt": "pnpm run run:write",
          "run:write": "prettier --write .",
        }),
      ).toBe("write-capable");

      // Delegation cycle fails closed as unknown
      expect(
        classifyScript("npm run loopA", {
          loopA: "npm run loopB",
          loopB: "npm run loopA",
        }),
      ).toBe("unknown");
    });

    it("supports positively identified read-only commands and rejects known write-capable commands in check mode", () => {
      const readOnlyScripts = {
        "format:check": "prettier --check .",
        "fmt:check": "vp fmt --check",
        "lint:check": "oxlint",
        lint: "eslint .",
      };
      const checkTasks = resolveScriptTasks(readOnlyScripts, "check");
      expect(checkTasks).toEqual([
        { capability: "format", scriptName: "format:check" },
        { capability: "lint", scriptName: "lint:check" },
      ]);

      const writeCapableScripts = {
        "format:check": "prettier --write .",
        "fmt:check": "oxfmt --write .",
        "lint:check": "eslint --fix .",
        lint: "oxlint --fix",
      };
      const writeTasks = resolveScriptTasks(writeCapableScripts, "check");
      expect(writeTasks).toEqual([]);
    });

    it("verifies formatter detection rejects echo, read-only commands, and unknown behavior in fix mode", () => {
      // "format: 'echo formatting is disabled'" does not qualify as a formatter
      expect(
        resolveScriptTasks(
          {
            format: "echo formatting is disabled",
          },
          "fix",
        ),
      ).toEqual([]);

      // Generic format delegating to a read-only script does not qualify
      expect(
        resolveScriptTasks(
          {
            format: "npm run check-format",
            "check-format": "prettier --check .",
          },
          "fix",
        ),
      ).toEqual([]);

      // Generic format with unknown behavior does not qualify
      expect(
        resolveScriptTasks(
          {
            format: "node scripts/run-format.js",
          },
          "fix",
        ),
      ).toEqual([]);

      // Generic scripts with verified write-capable commands are selected
      expect(
        resolveScriptTasks(
          {
            format: "prettier --write .",
          },
          "fix",
        ),
      ).toEqual([{ capability: "format", scriptName: "format" }]);

      expect(
        resolveScriptTasks(
          {
            fmt: "vp fmt",
          },
          "fix",
        ),
      ).toEqual([{ capability: "format", scriptName: "fmt" }]);
    });

    it("ensures invalid generic format scripts do not suppress dedicated formatter adapters", async () => {
      // A project with prettier configured and format: "echo formatting is disabled"
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            format: "echo formatting is disabled",
          },
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");

      // Prettier formatter adapter must NOT be suppressed by the invalid echo format script!
      expect(plan.selectedTools.map((t) => t.id)).toContain("prettier");
      expect(plan.tasks.map((t) => t.id)).toEqual(["prettier-format"]);
    });

    it("ensures invalid format:write and format:fix bodies do not claim formatting capability", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "echo not a formatter",
            "format:fix": "prettier --check .",
          },
          devDependencies: { prettier: "^3.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");

      // Neither invalid script is planned as a format task; Prettier runs cleanly
      expect(plan.selectedTools.map((t) => t.id)).toContain("prettier");
      expect(plan.tasks.map((t) => t.id)).toEqual(["prettier-format"]);
    });

    it("preserves Vite+ behavior including vp fmt --check and vp fmt", () => {
      // vp fmt --check is read-only
      expect(classifyScript("vp fmt --check")).toBe("read-only");
      expect(classifyScript("vp fmt -c")).toBe("read-only");

      // vp fmt is write-capable
      expect(classifyScript("vp fmt")).toBe("write-capable");

      // vp fmt --check in check mode is selected
      const checkTasks = resolveScriptTasks({ "fmt:check": "vp fmt --check" }, "check");
      expect(checkTasks).toEqual([{ capability: "format", scriptName: "fmt:check" }]);

      // vp fmt in fix mode is selected
      const fixTasks = resolveScriptTasks({ fmt: "vp fmt" }, "fix");
      expect(fixTasks).toEqual([{ capability: "format", scriptName: "fmt" }]);
    });

    it("prevents unsafe shell constructs, redirections, backgrounding, and substitutions from being classified as read-only", () => {
      // Background execution: &
      expect(classifyScript("eslint . & touch marker.txt")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint . & touch marker.txt",
          },
          "check",
        ),
      ).toEqual([]);

      // Output redirection: >, >>, 2>, 2>>, &>
      expect(classifyScript("prettier --check . > package.json")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "format:check": "prettier --check . > package.json",
          },
          "check",
        ),
      ).toEqual([]);

      expect(classifyScript("eslint . >> output.log")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint . >> output.log",
          },
          "check",
        ),
      ).toEqual([]);

      expect(classifyScript("eslint . 2> errors.log")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint . 2> errors.log",
          },
          "check",
        ),
      ).toEqual([]);

      expect(classifyScript("eslint . 2>> errors.log")).toBe("unknown");
      expect(classifyScript("eslint . &> errors.log")).toBe("unknown");

      // Command substitutions: $(...) and `...`
      expect(classifyScript('eslint "$(touch marker.txt)"')).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": 'eslint "$(touch marker.txt)"',
          },
          "check",
        ),
      ).toEqual([]);

      expect(classifyScript("eslint `touch marker.txt`")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint `touch marker.txt`",
          },
          "check",
        ),
      ).toEqual([]);

      // Process substitutions: <(...) and >(...)
      expect(classifyScript("eslint <(touch marker.txt)")).toBe("unknown");
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint <(touch marker.txt)",
          },
          "check",
        ),
      ).toEqual([]);

      expect(classifyScript("eslint >(touch marker.txt)")).toBe("unknown");

      // Malformed quotes or unclosed command substitutions
      expect(classifyScript('eslint "unterminated')).toBe("unknown");
      expect(classifyScript("eslint 'unterminated")).toBe("unknown");
      expect(classifyScript("eslint $(touch marker.txt")).toBe("unknown");
      expect(classifyScript("eslint `touch marker.txt")).toBe("unknown");

      // Valid chained read-only commands continue to work
      expect(classifyScript("eslint . && prettier --check .")).toBe("read-only");

      // Valid quoted arguments containing characters that should not be treated as shell operators
      expect(classifyScript('eslint --rule "semi: [error, always]"')).toBe("read-only");
      expect(classifyScript("prettier --check 'src/**/*.{js,ts}'")).toBe("read-only");
      expect(classifyScript('echo "> not redirected"')).toBe("unknown"); // echo is unknown command, not read-only

      // Escaped shell characters are literal
      expect(classifyScript("eslint \\>")).toBe("read-only");
    });

    it("rejects shell parameter expansions outside single quotes in check mode", () => {
      // Unquoted variable expansions
      expect(classifyScript("eslint . $VAR")).toBe("unknown");
      expect(classifyScript("eslint . ${VAR}")).toBe("unknown");

      // Quoted variable expansions
      expect(classifyScript('eslint . "$VAR"')).toBe("unknown");
      expect(classifyScript('eslint . "${VAR}"')).toBe("unknown");

      // Positional and special parameters
      expect(classifyScript("eslint . $@")).toBe("unknown");
      expect(classifyScript('eslint . "$@"')).toBe("unknown");
      expect(classifyScript("eslint . $*")).toBe("unknown");
      expect(classifyScript('eslint . "$*"')).toBe("unknown");
      expect(classifyScript("eslint . $1")).toBe("unknown");
      expect(classifyScript("eslint . $2")).toBe("unknown");
      expect(classifyScript('eslint . "$1"')).toBe("unknown");
      expect(classifyScript("eslint . $?")).toBe("unknown");
      expect(classifyScript("eslint . $$")).toBe("unknown");
      expect(classifyScript("eslint . $!")).toBe("unknown");
      expect(classifyScript("eslint . $#")).toBe("unknown");

      // Check mode resolves no tasks for scripts containing unsupported parameter expansion
      expect(
        resolveScriptTasks(
          {
            "lint:check": "eslint . $VAR",
            "format:check": 'prettier --check . "${PRETTIER_ARGS}"',
          },
          "check",
        ),
      ).toEqual([]);

      // Regression test: Environment variable injecting arguments into ESLint check script
      // e.g. LINT_ARGS="--fix" would turn a check command into a modifying command
      const envInjectionScripts = {
        "lint:check": 'eslint . "$LINT_ARGS"',
      };
      expect(classifyScript(envInjectionScripts["lint:check"])).toBe("unknown");
      expect(resolveScriptTasks(envInjectionScripts, "check")).toEqual([]);

      // Escaped dollar characters are literal and not shell expansions
      expect(classifyScript("eslint . \\$VAR")).toBe("read-only");
      expect(classifyScript('eslint . "\\$VAR"')).toBe("read-only");

      // Dollar characters inside single-quoted strings are literal (no shell parameter expansion)
      expect(classifyScript("eslint . '$VAR'")).toBe("read-only");
      expect(classifyScript("eslint . '${VAR}'")).toBe("read-only");
      expect(classifyScript("eslint . '$@'")).toBe("read-only");
      expect(classifyScript("eslint . '$1'")).toBe("read-only");

      // Literal dollar characters that are not shell expansions
      expect(classifyScript("eslint . $")).toBe("read-only");
      expect(classifyScript("eslint . $.")).toBe("read-only");
    });

    it("falls back to fmt:check when format:check cannot be safely classified as read-only", () => {
      // 1. Unknown format:check with valid fmt:check -> selects fmt:check
      const unknownFormatWithValidFmt = {
        "format:check": "node scripts/custom-format.js",
        "fmt:check": "prettier --check .",
      };
      expect(resolveScriptTasks(unknownFormatWithValidFmt, "check")).toEqual([
        { capability: "format", scriptName: "fmt:check" },
      ]);

      // 2. Write-capable format:check with valid fmt:check -> selects fmt:check
      const writeFormatWithValidFmt = {
        "format:check": "prettier --write .",
        "fmt:check": "prettier --check .",
      };
      expect(resolveScriptTasks(writeFormatWithValidFmt, "check")).toEqual([
        { capability: "format", scriptName: "fmt:check" },
      ]);

      // 3. Read-only format:check takes precedence over fmt:check
      const bothReadOnly = {
        "format:check": "prettier --check .",
        "fmt:check": "vp fmt --check",
      };
      expect(resolveScriptTasks(bothReadOnly, "check")).toEqual([
        { capability: "format", scriptName: "format:check" },
      ]);

      // 4. Both candidates unknown -> none selected
      const bothUnknown = {
        "format:check": "node scripts/format.js",
        "fmt:check": "python -m format",
      };
      expect(resolveScriptTasks(bothUnknown, "check")).toEqual([]);

      // 5. Both candidates write-capable -> none selected
      const bothWriteCapable = {
        "format:check": "prettier --write .",
        "fmt:check": "vp fmt",
      };
      expect(resolveScriptTasks(bothWriteCapable, "check")).toEqual([]);

      // 6. Only one valid candidate exists
      expect(resolveScriptTasks({ "fmt:check": "prettier --check ." }, "check")).toEqual([
        { capability: "format", scriptName: "fmt:check" },
      ]);
      expect(resolveScriptTasks({ "format:check": "prettier --check ." }, "check")).toEqual([
        { capability: "format", scriptName: "format:check" },
      ]);
    });
  });

  describe("Vite+ Detection & False-Positive Prevention", () => {
    it("detects Vite+ when package script invokes vp command directly", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fmt: "vp fmt",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      // Script fmt runs, and VitePlusAdapter is detected (and fmt script covers format)
      expect(plan.selectedTools.map((t) => t.id)).toContain("vite-plus");
    });

    it("detects Vite+ when package script invokes vp in chained command or with env prefix", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            build: "echo ready && vp build",
            check: "NODE_ENV=production vp check",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools.map((t) => t.id)).toContain("vite-plus");
      expect(plan.tasks.map((t) => t.id)).toContain("vite-plus-fmt");
      expect(plan.tasks.map((t) => t.id)).toContain("vite-plus-lint-fix");
    });

    it("detects Vite+ through command wrappers: cross-env, sh -c, bash -c, and runner wrappers", async () => {
      // 1. cross-env
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            format: "cross-env NODE_ENV=production vp fmt",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const planCrossEnv = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnv.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 2. cross-env-shell
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            format: "cross-env-shell NODE_ENV=production vp fmt",
          },
        }),
      );
      const planCrossEnvShell = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvShell.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 3. cross-env with multiple environment variable assignments
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            formatMultipleEnv: "cross-env CI=true NODE_ENV=production vp lint",
          },
        }),
      );
      const planCrossEnvMultiple = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvMultiple.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 4. cross-env delegating to a script that invokes vp
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            formatDelegated: "cross-env NODE_ENV=production npm run format:vp",
            "format:vp": "vp fmt",
          },
        }),
      );
      const planCrossEnvDelegated = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvDelegated.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 5. unsupported options or flags must not be treated as valid and must not cause false-positive Vite+ detection
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            formatShort: "cross-env -f .env vp fmt",
            formatLong: "cross-env --file .env vp fmt",
            formatUnknown: "cross-env -unknown-flag vp fmt",
          },
        }),
      );
      const planCrossEnvUnknown = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvUnknown.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 6. cross-env with missing command after environment assignments
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            noCommand: "cross-env NODE_ENV=production",
          },
        }),
      );
      const planCrossEnvNoCommand = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvNoCommand.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 7. cross-env running an unrelated command with vp in arguments must not trigger Vite+ detection
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            grepTest: "cross-env NODE_ENV=production grep vp file.txt",
          },
        }),
      );
      const planCrossEnvGrep = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planCrossEnvGrep.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 5. sh -c
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            check: "sh -c 'vp check'",
          },
        }),
      );
      const planSh = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planSh.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 6. bash -c
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fmt: "bash -c 'vp fmt'",
          },
        }),
      );
      const planBash = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planBash.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 7. npx vp / bunx vp / pnpm exec vp
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fmt1: "npx vp fmt",
            fmt2: "bunx vp fmt",
            fmt3: "pnpm exec vp fmt",
          },
        }),
      );
      const planRunners = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planRunners.selectedTools.map((t) => t.id)).toContain("vite-plus");

      // 8. script delegation invoking vp
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            all: "npm run vp-task",
            "vp-task": "vp fmt",
          },
        }),
      );
      const planDelegation = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planDelegation.selectedTools.map((t) => t.id)).toContain("vite-plus");
    });

    it("prevents false positive when 'vp ' only appears inside echo or descriptive string", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            help: 'echo "vp is not installed"',
            info: 'echo "run vp fmt later"',
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools.map((t) => t.id)).not.toContain("vite-plus");
      expect(plan.tasks.map((t) => t.id)).not.toContain("vite-plus-fmt");
      expect(plan.tasks.map((t) => t.id)).not.toContain("vite-plus-lint-fix");
    });

    it("prevents false positive when 'vp ' only appears in a comment", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node test.js # vp fmt",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools.map((t) => t.id)).not.toContain("vite-plus");
    });

    it("prevents false positive when 'vp' appears as an argument to an unrelated command", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            search: "grep vp file.txt",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools.map((t) => t.id)).not.toContain("vite-plus");
    });

    it("prevents false positive when project has vite.config.ts but scripts do not invoke vp", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            build: "vite build",
            test: "vitest run",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.selectedTools.map((t) => t.id)).not.toContain("vite-plus");
    });

    it("rejects malformed commands with confirmed shell syntax errors during Vite+ detection", async () => {
      // 1. Unterminated single quote
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken1: "vp fmt 'unterminated",
          },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {};");

      const registry = createDefaultRegistry();
      const planSingle = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planSingle.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 2. Unterminated double quote
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken2: 'vp fmt "unterminated',
          },
        }),
      );
      const planDouble = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planDouble.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 3. Command ending with an incomplete trailing escape \
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken3: "vp fmt \\",
          },
        }),
      );
      const planEscape = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planEscape.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 4. Malformed nested shell-wrapper invocation (unterminated quote in sh -c argument)
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken4: "sh -c 'vp check",
          },
        }),
      );
      const planMalformedSh = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planMalformedSh.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 5. Malformed nested shell-wrapper invocation (unterminated quote inside wrapped script)
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken5: 'bash -c "vp fmt \'unterminated"',
          },
        }),
      );
      const planMalformedBash = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planMalformedBash.selectedTools.map((t) => t.id)).not.toContain("vite-plus");

      // 6. Malformed command containing vp in argument position
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            broken6: "grep 'unterminated vp",
          },
        }),
      );
      const planGrepMalformed = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(planGrepMalformed.selectedTools.map((t) => t.id)).not.toContain("vite-plus");
    });
  });

  describe("Multi-Language Monorepo Capability Isolation", () => {
    it("preserves independent tasks for Python (Ruff) and JavaScript (Prettier/ESLint) without mutual suppression", async () => {
      // Python source file
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");

      // JS configuration with prettier and eslint
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir, hasPythonSource: true }, "fix");

      // Verify Python tasks are scheduled (Ruff lint and format)
      expect(plan.tasks.some((t) => t.id === "ruff-lint-fix")).toBe(true);
      expect(plan.tasks.some((t) => t.id === "ruff-format")).toBe(true);

      // Verify JavaScript tasks are NOT suppressed by Python's lint/format capabilities
      expect(plan.tasks.some((t) => t.id === "script-format:write")).toBe(true);
      expect(plan.tasks.some((t) => t.id === "script-lint:fix")).toBe(true);

      // Verify plan contains all 4 tasks
      expect(plan.tasks.map((t) => t.id)).toEqual([
        "ruff-lint-fix",
        "ruff-format",
        "script-format:write",
        "script-lint:fix",
      ]);

      // Summary contains both Python and JavaScript toolchains
      expect(plan.summary).toContain("Python toolchain:");
      expect(plan.summary).toContain("Ruff: default tool");
      expect(plan.summary).toContain("JavaScript toolchain:");
    });
  });

  describe("Standalone Adapter Conflict Resolution", () => {
    it("skips a standalone adapter task when its capability is already covered by a regular adapter in the same scope", async () => {
      const registry = createDefaultRegistry();

      class StandaloneFormatAdapter implements ToolAdapter {
        id = "standalone-fmt";
        name = "Standalone Formatter";
        capabilities: ["format"] = ["format"];
        scope = "javascript";
        detect() {
          return { detected: true, reason: "standalone formatter config detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "standalone-fmt-task",
              toolId: this.id,
              capability: "format",
              executable: "standalone-fmt",
              args: ["."],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      registry.registerAdapter(new StandaloneFormatAdapter());

      // Configure explicit script covering format
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
        }),
      );

      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.tasks.map((t) => t.id)).toEqual(["script-format:write"]);
      expect(plan.skippedTools).toContainEqual(
        expect.objectContaining({
          id: "standalone-fmt",
          reason: "all capabilities already covered by higher priority tool",
        }),
      );
    });

    it("skips a lower-priority adapter when a higher-priority standalone adapter ran first and covered the capability in the same scope", async () => {
      const customRegistry = new AutofixRegistry();

      class StandaloneFormatAdapter implements ToolAdapter {
        id = "standalone-fmt";
        name = "Standalone Formatter";
        capabilities: ["format"] = ["format"];
        scope = "custom-format-scope";
        detect() {
          return { detected: true, reason: "standalone formatter config detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "standalone-fmt-task",
              toolId: this.id,
              capability: "format",
              executable: "standalone-fmt",
              args: ["."],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      // Test two standalone adapters sharing the same scope where first standalone adapter conflicts with second standalone adapter:
      class SecondStandaloneFormatAdapter implements ToolAdapter {
        id = "second-fmt";
        name = "Second Formatter";
        capabilities: ["format"] = ["format"];
        scope = "custom-format-scope";
        detect() {
          return { detected: true, reason: "second formatter config detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "second-fmt-task",
              toolId: this.id,
              capability: "format",
              executable: "second-fmt",
              args: ["."],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      customRegistry.registerAdapter(new StandaloneFormatAdapter());
      customRegistry.registerAdapter(new SecondStandaloneFormatAdapter());

      const plan = await planExecution(customRegistry, { cwd: tempDir }, "fix");
      expect(plan.tasks.map((t) => t.id)).toEqual(["standalone-fmt-task"]);
      expect(plan.skippedTools).toContainEqual(
        expect.objectContaining({
          id: "second-fmt",
          reason: "all capabilities already covered by higher priority tool",
        }),
      );
    });

    it("retains tasks when standalone and regular adapters produce independent capabilities", async () => {
      const registry = createDefaultRegistry();

      class StandaloneTypecheckAdapter implements ToolAdapter {
        id = "standalone-typecheck";
        name = "Standalone Typechecker";
        capabilities: ["typecheck"] = ["typecheck"];
        detect() {
          return { detected: true, reason: "typecheck config detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "standalone-typecheck-task",
              toolId: this.id,
              capability: "typecheck",
              executable: "tsc",
              args: ["--noEmit"],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      registry.registerAdapter(new StandaloneTypecheckAdapter());

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
        }),
      );

      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.tasks.map((t) => t.id)).toEqual([
        "script-format:write",
        "standalone-typecheck-task",
      ]);
      expect(plan.selectedTools.map((t) => t.id)).toContain("standalone-typecheck");
    });

    it("partially skips overlapping capabilities between standalone and regular adapters in the same scope", async () => {
      const registry = createDefaultRegistry();

      class StandaloneMultiToolAdapter implements ToolAdapter {
        id = "standalone-multi";
        name = "Standalone Multi Tool";
        capabilities: ["format", "assist"] = ["format", "assist"];
        scope = "javascript";
        detect() {
          return { detected: true, reason: "multi tool config detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "standalone-multi-fmt",
              toolId: this.id,
              capability: "format",
              executable: "standalone-multi",
              args: ["fmt"],
              cwd: ctx.cwd,
              mode,
            },
            {
              id: "standalone-multi-assist",
              toolId: this.id,
              capability: "assist",
              executable: "standalone-multi",
              args: ["assist"],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      registry.registerAdapter(new StandaloneMultiToolAdapter());

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            "format:write": "prettier --write .",
          },
        }),
      );

      const plan = await planExecution(registry, { cwd: tempDir }, "fix");
      expect(plan.tasks.map((t) => t.id)).toEqual([
        "script-format:write",
        "standalone-multi-assist",
      ]);
      expect(plan.skippedTools).toContainEqual(
        expect.objectContaining({
          id: "standalone-multi",
          reason: "partially skipped (format covered by higher priority tool)",
        }),
      );
    });

    it("preserves task ID deduplication behavior", async () => {
      const customRegistry = new AutofixRegistry();

      class StandaloneAdapter1 implements ToolAdapter {
        id = "adapter-1";
        name = "Adapter 1";
        capabilities: ["typecheck"] = ["typecheck"];
        detect() {
          return { detected: true, reason: "adapter 1 detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "shared-task-id",
              toolId: this.id,
              capability: "typecheck",
              executable: "check-1",
              args: [],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      class StandaloneAdapter2 implements ToolAdapter {
        id = "adapter-2";
        name = "Adapter 2";
        capabilities: ["assist"] = ["assist"];
        detect() {
          return { detected: true, reason: "adapter 2 detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "shared-task-id",
              toolId: this.id,
              capability: "assist",
              executable: "check-2",
              args: [],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      customRegistry.registerAdapter(new StandaloneAdapter1());
      customRegistry.registerAdapter(new StandaloneAdapter2());

      const plan = await planExecution(customRegistry, { cwd: tempDir }, "fix");
      // Even though capabilities are independent (typecheck vs assist), task IDs are identical, so second is deduplicated
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].executable).toBe("check-1");
    });

    it("ensures standalone adapters without explicit scope do not conflict with each other or provider adapters", async () => {
      const customRegistry = new AutofixRegistry();

      // Standalone format adapter with default scope
      class StandaloneDefault1 implements ToolAdapter {
        id = "default-standalone-1";
        name = "Default Standalone 1";
        capabilities: ["format"] = ["format"];
        detect() {
          return { detected: true, reason: "default standalone 1 detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "default-standalone-1-fmt",
              toolId: this.id,
              capability: "format",
              executable: "fmt-1",
              args: [],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      // Standalone format adapter with default scope
      class StandaloneDefault2 implements ToolAdapter {
        id = "default-standalone-2";
        name = "Default Standalone 2";
        capabilities: ["format"] = ["format"];
        detect() {
          return { detected: true, reason: "default standalone 2 detected" };
        }
        plan(ctx: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
          return [
            {
              id: "default-standalone-2-fmt",
              toolId: this.id,
              capability: "format",
              executable: "fmt-2",
              args: [],
              cwd: ctx.cwd,
              mode,
            },
          ];
        }
      }

      customRegistry.registerAdapter(new StandaloneDefault1());
      customRegistry.registerAdapter(new StandaloneDefault2());

      const plan = await planExecution(customRegistry, { cwd: tempDir }, "fix");
      // Both default standalone adapters have independent default scopes (standalone:default-standalone-1 and standalone:default-standalone-2),
      // so neither suppresses the other!
      expect(plan.tasks.map((t) => t.id)).toEqual([
        "default-standalone-1-fmt",
        "default-standalone-2-fmt",
      ]);
    });
  });

  describe("Registry Extensibility", () => {
    it("resolves project binaries and Windows executable shims cleanly", async () => {
      const binDir = path.join(tempDir, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });

      // 1. Unix extensionless local binary
      const prettierUnix = path.join(binDir, "prettier");
      fs.writeFileSync(prettierUnix, "");
      const resolvedUnix = await resolveProjectBinary(tempDir, "prettier", "linux");
      expect(resolvedUnix).toBe(prettierUnix);

      // On Windows without extension or shim, returns extensionless if exists
      const resolvedWinFallback = await resolveProjectBinary(tempDir, "prettier", "win32");
      expect(resolvedWinFallback).toBe(prettierUnix);

      // 2. Windows .cmd local shim
      const eslintCmd = path.join(binDir, "eslint.cmd");
      const eslintPs1 = path.join(binDir, "eslint.ps1");
      fs.writeFileSync(eslintCmd, "@echo off\n");
      fs.writeFileSync(eslintPs1, "Write-Host 'shim'\n");

      // On win32, should resolve .cmd and NOT select .ps1
      const resolvedWinCmd = await resolveProjectBinary(tempDir, "eslint", "win32");
      expect(resolvedWinCmd).toBe(eslintCmd);

      // On linux, does not automatically append .cmd
      const resolvedLinuxCmd = await resolveProjectBinary(tempDir, "eslint", "linux");
      expect(resolvedLinuxCmd).toBeUndefined();

      // Explicit extensions provided on Windows: .cmd, .bat, .exe
      const batShim = path.join(binDir, "tool.bat");
      const exeShim = path.join(binDir, "tool.exe");
      fs.writeFileSync(batShim, "@echo off\n");
      fs.writeFileSync(exeShim, "");

      const resolvedExplicitCmd = await resolveProjectBinary(tempDir, "eslint.cmd", "win32");
      expect(resolvedExplicitCmd).toBe(eslintCmd);

      const resolvedExplicitBat = await resolveProjectBinary(tempDir, "tool.bat", "win32");
      expect(resolvedExplicitBat).toBe(batShim);

      const resolvedExplicitExe = await resolveProjectBinary(tempDir, "tool.exe", "win32");
      expect(resolvedExplicitExe).toBe(exeShim);

      // Explicit unsupported extensions (.ps1, .js, .sh, .vbs) must NOT be returned on Windows even if the files exist
      const jsShim = path.join(binDir, "tool.js");
      const shShim = path.join(binDir, "tool.sh");
      const vbsShim = path.join(binDir, "tool.vbs");
      fs.writeFileSync(jsShim, "console.log('js');");
      fs.writeFileSync(shShim, "#!/bin/sh\nexit 0");
      fs.writeFileSync(vbsShim, "WScript.Quit 0");

      expect(await resolveProjectBinary(tempDir, "eslint.ps1", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "tool.js", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "tool.sh", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "tool.vbs", "win32")).toBeUndefined();

      // Missing explicit shim returns undefined
      const resolvedMissingExplicit = await resolveProjectBinary(tempDir, "missing.cmd", "win32");
      expect(resolvedMissingExplicit).toBeUndefined();

      // 3. Missing local binary with successful io.which fallback
      vi.spyOn(io, "which").mockImplementation(async (tool) => {
        if (tool === "biome") return "/usr/local/bin/biome";
        return "";
      });
      const resolvedWhich = await resolveProjectBinary(tempDir, "biome", "linux");
      expect(resolvedWhich).toBe("/usr/local/bin/biome");

      const resolvedWhichWin = await resolveProjectBinary(tempDir, "biome", "win32");
      expect(resolvedWhichWin).toBe("/usr/local/bin/biome");

      // io.which returning unsupported extensions (.ps1, .js, .sh, .vbs) on Windows is rejected
      vi.spyOn(io, "which").mockImplementation(async (tool) => {
        if (tool === "ps-tool") return "C:\\tools\\ps-tool.ps1";
        if (tool === "js-tool") return "C:\\tools\\js-tool.js";
        if (tool === "sh-tool") return "C:\\tools\\sh-tool.sh";
        if (tool === "vbs-tool") return "C:\\tools\\vbs-tool.vbs";
        return "";
      });
      expect(await resolveProjectBinary(tempDir, "ps-tool", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "js-tool", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "sh-tool", "win32")).toBeUndefined();
      expect(await resolveProjectBinary(tempDir, "vbs-tool", "win32")).toBeUndefined();

      // 4. Missing binary with no fallback result
      const resolvedMissing = await resolveProjectBinary(tempDir, "nonexistent-tool", "linux");
      expect(resolvedMissing).toBeUndefined();

      const resolvedMissingWin = await resolveProjectBinary(tempDir, "nonexistent-tool", "win32");
      expect(resolvedMissingWin).toBeUndefined();

      // 5. Correct executable invocation via ExecutionEngine on Windows
      const winEngine = new ExecutionEngine("win32");
      vi.mocked(exec.exec).mockResolvedValue(0);

      const winTask: ExecutionTask = {
        id: "eslint-fix",
        toolId: "eslint",
        capability: "lint",
        executable: "eslint",
        args: ["--fix", "."],
        cwd: tempDir,
        mode: "fix",
      };

      const resolvedExe = await winEngine.resolveTaskExecutable(winTask);
      expect(resolvedExe).toBe(eslintCmd);

      const results = await winEngine.executeTasks([winTask]);
      expect(results).toHaveLength(1);
      expect(results[0].exitCode).toBe(0);
      expect(exec.exec).toHaveBeenCalledWith(
        eslintCmd,
        ["--fix", "."],
        expect.objectContaining({ cwd: tempDir }),
      );

      // Verify that ExecutionEngine throws an understandable, actionable error when a .ps1 task is planned
      const psTask: ExecutionTask = {
        id: "ps-task",
        toolId: "custom-ps",
        capability: "lint",
        executable: "tool.ps1",
        args: ["check"],
        cwd: tempDir,
        mode: "check",
      };
      await expect(winEngine.resolveTaskExecutable(psTask)).rejects.toThrow(
        /Configured tool "custom-ps" could not run: executable "tool.ps1" is not available in node_modules\/\.bin or PATH/,
      );
    });

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

  describe("Regression: F-01 Nested Delegation and Duplicate Task Prevention", () => {
    it("handles direct delegation: fix -> format:write", () => {
      const scripts = {
        fix: "npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "format", scriptName: "fix" }]);
    });

    it("handles one-level nested delegation: fix -> all-fix -> format:write", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "format", scriptName: "fix" }]);
    });

    it("handles multiple nested levels: fix -> all-fix -> frontend-fix -> format:write", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run frontend-fix",
        "frontend-fix": "npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "format", scriptName: "fix" }]);
    });

    it("handles nested lint delegation: fix -> all-fix -> lint:fix", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run lint:fix",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "lint", scriptName: "fix" }]);
    });

    it("handles a fix script that delegates to both formatting and linting across nested levels", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run format:write && npm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "format", capabilities: ["format", "lint"], scriptName: "fix" },
      ]);
    });

    it("handles a fix script that delegates only to formatting, while linting remains independent", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run format:write",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "format", scriptName: "fix" },
        { capability: "lint", scriptName: "lint:fix" },
      ]);
    });

    it("handles a fix script that delegates only to linting, while formatting remains independent", () => {
      const scripts = {
        fix: "npm run all-fix",
        "all-fix": "npm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "lint", scriptName: "fix" },
        { capability: "format", scriptName: "format:write" },
      ]);
    });

    it("safely handles circular script references without infinite recursion in delegation", () => {
      const scripts = {
        fix: "npm run cycle-a",
        "cycle-a": "npm run cycle-b",
        "cycle-b": "npm run cycle-a",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "typecheck", capabilities: [], scriptName: "fix" },
        { capability: "format", scriptName: "format:write" },
      ]);
    });

    it("leaves unrelated scripts independent", () => {
      const scripts = {
        fix: "echo custom-fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "typecheck", capabilities: [], scriptName: "fix" },
        { capability: "format", scriptName: "format:write" },
        { capability: "lint", scriptName: "lint:fix" },
      ]);
    });

    it("handles delegation through cross-env environment wrappers", () => {
      const scripts = {
        fix: "cross-env CI=1 npm run format:write && npm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "format", capabilities: ["format", "lint"], scriptName: "fix" },
      ]);
    });

    it("handles delegation through cross-env-shell environment wrappers", () => {
      const scripts = {
        fix: "cross-env-shell NODE_ENV=production npm run lint:fix",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "lint", scriptName: "fix" }]);
    });

    it("handles multiple environment assignments with cross-env and cross-env-shell", () => {
      const scripts = {
        fix: "cross-env CI=1 NODE_ENV=production DEBUG=false npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "format", scriptName: "fix" }]);
    });

    it("handles cross-env delegation with no environment assignments", () => {
      const scripts = {
        fix: "cross-env npm run format:write",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([{ capability: "format", scriptName: "fix" }]);
    });

    it("handles nested delegation with environment wrappers", () => {
      const scripts = {
        fix: "cross-env CI=1 npm run all-fix",
        "all-fix": "cross-env-shell NODE_ENV=production npm run format:write && npm run lint:fix",
        "format:write": "prettier --write .",
        "lint:fix": "eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "format", capabilities: ["format", "lint"], scriptName: "fix" },
      ]);
    });

    it("handles cyclic delegation safely when wrapped in cross-env", () => {
      const scripts = {
        fix: "cross-env CI=1 npm run cycle-a",
        "cycle-a": "cross-env NODE_ENV=development npm run cycle-b",
        "cycle-b": "cross-env npm run cycle-a",
        "format:write": "prettier --write .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "typecheck", capabilities: [], scriptName: "fix" },
        { capability: "format", scriptName: "format:write" },
      ]);
    });

    it("verifies execution planning with cross-env delegation prevents duplicate task scheduling", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: {
            fix: "cross-env CI=1 npm run format:write && npm run lint:fix",
            "format:write": "prettier --write .",
            "lint:fix": "eslint --fix .",
          },
        }),
      );

      const registry = createDefaultRegistry();
      const plan = await planExecution(registry, { cwd: tempDir }, "fix");

      expect(plan.tasks.map((t) => t.id)).toEqual(["script-fix"]);
      expect(plan.tasks[0].capability).toBe("format");
      expect(plan.tasks[0].capabilities).toEqual(["format", "lint"]);
    });

    it("verifies direct tool verification with cross-env", () => {
      const scripts = {
        fix: "cross-env CI=1 prettier --write . && cross-env-shell NODE_ENV=production eslint --fix .",
      };
      const tasks = resolveScriptTasks(scripts, "fix");
      expect(tasks).toEqual([
        { capability: "format", capabilities: ["format", "lint"], scriptName: "fix" },
      ]);
    });

    it("verifies check mode classification with cross-env", () => {
      const checkScripts = {
        "format:check": "cross-env CI=1 prettier --check .",
        "lint:check": "cross-env-shell NODE_ENV=production eslint .",
      };
      const tasks = resolveScriptTasks(checkScripts, "check");
      expect(tasks).toEqual([
        { capability: "format", scriptName: "format:check" },
        { capability: "lint", scriptName: "lint:check" },
      ]);
    });
  });

  describe("Regression: F-02 Read-Only Classifier Audit for File-Writing Options", () => {
    it("classifies ESLint with --fix, --cache, and --output-file as non-read-only", () => {
      expect(classifyScript("eslint --fix .")).toBe("write-capable");
      expect(classifyScript("eslint . --cache")).toBe("unknown");
      expect(classifyScript("eslint . --cache-file .eslintcache")).toBe("unknown");
      expect(classifyScript("eslint . --cache-location ./cache/")).toBe("unknown");
      expect(classifyScript("eslint . --output-file report.json")).toBe("unknown");
      expect(classifyScript("eslint . -o report.json")).toBe("unknown");
      expect(classifyScript("eslint . --output-file=report.json")).toBe("unknown");
      expect(classifyScript("eslint . -o=report.json")).toBe("unknown");

      // Dry-run does not write modified source files.
      expect(classifyScript("eslint . --fix-dry-run")).toBe("read-only");

      // Dry-run combined with an output file is not read-only.
      expect(classifyScript("eslint . --fix-dry-run -o report.json")).toBe("unknown");
      expect(classifyScript("eslint . --fix-dry-run --output-file report.json")).toBe("unknown");

      // Cache still prevents read-only classification even with --fix-dry-run.
      expect(classifyScript("eslint . --fix-dry-run --cache")).toBe("unknown");
      expect(classifyScript("eslint . --fix-dry-run --cache-location .cache")).toBe("unknown");

      // Check mode resolution rejects writing combinations but accepts read-only dry-run
      expect(resolveScriptTasks({ "lint:check": "eslint . --cache" }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "lint:check": "eslint . -o report.json" }, "check")).toEqual([]);
      expect(resolveScriptTasks({ "lint:check": "eslint . --fix-dry-run" }, "check")).toEqual([
        { capability: "lint", scriptName: "lint:check" },
      ]);
      expect(
        resolveScriptTasks({ "lint:check": "eslint . --fix-dry-run --cache" }, "check"),
      ).toEqual([]);
    });

    it("classifies Prettier write, check, and cache modes correctly", () => {
      expect(classifyScript("prettier --write .")).toBe("write-capable");
      expect(classifyScript("prettier -w .")).toBe("write-capable");
      expect(classifyScript("prettier --check .")).toBe("read-only");
      expect(classifyScript("prettier -c .")).toBe("read-only");
      expect(classifyScript("prettier --list-different .")).toBe("read-only");
      expect(classifyScript("prettier -l .")).toBe("read-only");

      // Cache or insert-pragma options write files
      expect(classifyScript("prettier --check . --cache")).toBe("unknown");
      expect(classifyScript("prettier --check . --cache-location .cache")).toBe("unknown");
      expect(classifyScript("prettier --check . --insert-pragma")).toBe("unknown");
    });

    it("classifies Biome write, check, and reporter/log output options correctly", () => {
      expect(classifyScript("biome format --write .")).toBe("write-capable");
      expect(classifyScript("biome format .")).toBe("read-only");
      expect(classifyScript("biome format . --reporter-file=out.json")).toBe("unknown");
      expect(classifyScript("biome format . --log-file=biome.log")).toBe("unknown");

      expect(classifyScript("biome lint --write .")).toBe("write-capable");
      expect(classifyScript("biome lint .")).toBe("read-only");
      expect(classifyScript("biome lint . --reporter-file=out.json")).toBe("unknown");
      expect(classifyScript("biome lint . --log-file=biome.log")).toBe("unknown");

      expect(classifyScript("biome check --write .")).toBe("write-capable");
      expect(classifyScript("biome check .")).toBe("read-only");
      expect(classifyScript("biome check . --reporter-file=out.json")).toBe("unknown");
      expect(classifyScript("biome check . --log-file=biome.log")).toBe("unknown");
    });

    it("classifies Oxlint fix, suggestions, dangerously, and check modes correctly", () => {
      expect(classifyScript("oxlint --fix")).toBe("write-capable");
      expect(classifyScript("oxlint --fix-suggestions")).toBe("unknown");
      expect(classifyScript("oxlint --fix-dangerously")).toBe("unknown");
      expect(classifyScript("oxlint --init")).toBe("unknown");
      expect(classifyScript("oxlint .")).toBe("read-only");
    });

    it("classifies Vite+ format and lint write/check modes correctly", () => {
      expect(classifyScript("vp fmt")).toBe("write-capable");
      expect(classifyScript("vp fmt --write")).toBe("write-capable");
      expect(classifyScript("vp fmt --check")).toBe("read-only");
      expect(classifyScript("vp fmt -c")).toBe("read-only");
      expect(classifyScript("vp fmt --check --init")).toBe("unknown");

      expect(classifyScript("vp lint --fix")).toBe("write-capable");
      expect(classifyScript("vp lint")).toBe("read-only");
      expect(classifyScript("vp lint --fix-suggestions")).toBe("unknown");

      expect(classifyScript("vp check --fix")).toBe("write-capable");
      expect(classifyScript("vp check")).toBe("read-only");
    });

    it("classifies unknown options and commands with quoted arguments correctly", () => {
      expect(classifyScript("eslint --unknown-option .")).toBe("read-only");
      expect(classifyScript('eslint . --rule "quotes: [error, double]"')).toBe("read-only");
      expect(classifyScript('prettier --check "src/**/*.ts"')).toBe("read-only");
      expect(classifyScript('eslint . --output-file "dir with spaces/report.json"')).toBe(
        "unknown",
      );
      expect(classifyScript("unknown-tool .")).toBe("unknown");
    });

    it("preserves genuinely read-only commands in check mode", () => {
      const scripts = {
        "format:check": "prettier --check .",
        "fmt:check": "oxfmt --check .",
        "lint:check": "eslint .",
        lint: "oxlint .",
      };
      const checkTasks = resolveScriptTasks(scripts, "check");
      expect(checkTasks).toEqual([
        { capability: "format", scriptName: "format:check" },
        { capability: "lint", scriptName: "lint:check" },
      ]);
    });
  });

  describe("Regression: F-03 Sequential Script Delegation vs Cycle Detection", () => {
    it("handles a script referencing the same child script twice sequentially", () => {
      const scripts = {
        lint: "npm run lint:base && npm run lint:base",
        "lint:base": "eslint .",
      };
      expect(classifyScript("npm run lint", scripts)).toBe("read-only");
      const tasks = resolveScriptTasks(scripts, "check");
      expect(tasks).toEqual([{ capability: "lint", scriptName: "lint" }]);
    });

    it("handles multiple independent branches referencing the same child script", () => {
      const scripts = {
        check: "npm run branch-a && npm run branch-b",
        "branch-a": "npm run common",
        "branch-b": "npm run common",
        common: "prettier --check .",
      };
      expect(classifyScript("npm run check", scripts)).toBe("read-only");
    });

    it("handles nested repeated delegation cleanly", () => {
      const scripts = {
        main: "npm run sub1 && npm run sub2",
        sub1: "npm run helper",
        sub2: "npm run helper",
        helper: "oxlint .",
      };
      expect(classifyScript("npm run main", scripts)).toBe("read-only");
    });

    it("detects genuine direct cycle: a -> a", () => {
      const scripts = {
        loop: "npm run loop",
      };
      expect(classifyScript("npm run loop", scripts)).toBe("unknown");
    });

    it("detects genuine indirect cycle: a -> b -> c -> a", () => {
      const scripts = {
        a: "npm run b",
        b: "npm run c",
        c: "npm run a",
      };
      expect(classifyScript("npm run a", scripts)).toBe("unknown");
    });

    it("handles a cycle inside one branch while another branch remains valid", () => {
      const scripts = {
        composite: "npm run broken || npm run valid",
        broken: "npm run loopA",
        loopA: "npm run loopB",
        loopB: "npm run loopA",
        valid: "eslint .",
      };
      // Because 'broken' is a cycle and evaluates to 'unknown', composite evaluates to 'unknown'
      expect(classifyScript("npm run composite", scripts)).toBe("unknown");
    });
  });
});
