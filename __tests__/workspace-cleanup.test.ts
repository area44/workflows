import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), ".github/scripts/test-workspace-cleanup.sh");

function runScript(
  args: string,
  cwd: string,
  options: { expectFailure?: boolean; env?: Record<string, string> } = {}
): string {
  try {
    const output = execSync(`bash "${SCRIPT_PATH}" ${args}`, {
      cwd,
      env: {
        ...process.env,
        RUNNER_TEMP: path.join(cwd, "runner_temp"),
        ...(options.env || {}),
      },
      stdio: "pipe",
      encoding: "utf8",
    });
    if (options.expectFailure) {
      throw new Error(`Expected script to fail but it succeeded with output: ${output}`);
    }
    return output;
  } catch (error: any) {
    if (options.expectFailure) {
      return error.stderr || error.stdout || error.message;
    }
    throw new Error(`Script failed unexpectedly: ${error.stderr || error.message}`);
  }
}

describe("Workspace Setup and Cleanup Shell Script", () => {
  let tempDir: string;
  let fixtureDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp_test_cleanup_"));
    fs.mkdirSync(path.join(tempDir, "runner_temp"), { recursive: true });

    fixtureDir = path.join(tempDir, "ext_fixture");
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "package.json"), JSON.stringify({ name: "fixture-pkg" }));
    fs.writeFileSync(path.join(fixtureDir, ".dotfile_fixture"), "dotfile-content");
    fs.mkdirSync(path.join(fixtureDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "nested", "file.txt"), "nested-content");
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("Scenario A: Setup fails before snapshot exists; pre-existing generated paths remain intact after cleanup", () => {
    const preExistingDirs = ["node_modules", "dist", ".venv", ".ruff_cache", "test.egg-info"];
    for (const dir of preExistingDirs) {
      const dirPath = path.join(tempDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "sentinel.txt"), `sentinel-in-${dir}`);
    }

    // Force setup to fail before snapshot initialization
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_BEFORE_SNAPSHOT: "1" },
    });

    // Run cleanup
    runScript("cleanup", tempDir);

    // All original sentinels survive
    for (const dir of preExistingDirs) {
      const sentinelPath = path.join(tempDir, dir, "sentinel.txt");
      expect(fs.existsSync(sentinelPath)).toBe(true);
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe(`sentinel-in-${dir}`);
    }
  });

  it("Scenario B: Setup fails during partial snapshot creation; cleanup preserves generated paths", () => {
    const preExistingDirs = ["node_modules", "dist", ".venv"];
    for (const dir of preExistingDirs) {
      const dirPath = path.join(tempDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "sentinel.txt"), `sentinel-in-${dir}`);
    }

    // Inject failure during snapshot creation
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_IN_SNAPSHOT: "1" },
    });

    // Run cleanup
    runScript("cleanup", tempDir);

    // Verify snapshot status is incomplete and no generated paths were deleted
    for (const dir of preExistingDirs) {
      const sentinelPath = path.join(tempDir, dir, "sentinel.txt");
      expect(fs.existsSync(sentinelPath)).toBe(true);
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe(`sentinel-in-${dir}`);
    }
  });

  it("Scenario C: Fixture copy fails partway through; cleanup removes installed files and restores originals", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");
    const unrelatedFile = path.join(tempDir, "unrelated.txt");
    fs.writeFileSync(unrelatedFile, "unrelated-data");

    // Inject failure partway through fixture copy
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_IN_COPY: "1" },
    });

    // Run cleanup
    runScript("cleanup", tempDir);

    // Original package.json restored, unrelated file intact, installed fixture files cleaned up
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.readFileSync(unrelatedFile, "utf8")).toBe("unrelated-data");
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("Scenario D: Restoration genuinely fails; backup file and state directory are preserved", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    // Inject restore failure
    runScript("cleanup", tempDir, { env: { INJECT_FAILURE_RESTORE: "1" } });

    // Assert state directory and backup files remain for manual recovery
    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.existsSync(stateDir)).toBe(true);
    expect(fs.existsSync(path.join(stateDir, "backed_up_files"))).toBe(true);
  });

  it("Scenario E: Setup fails after stashing __tests__; cleanup restores original __tests__ directory", () => {
    const origTestsFile = path.join(tempDir, "__tests__", "my_test.test.js");
    fs.mkdirSync(path.dirname(origTestsFile), { recursive: true });
    fs.writeFileSync(origTestsFile, "console.log('original test');");

    // Force failure after stash step
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_STASH: "1" },
    });

    // Run cleanup
    runScript("cleanup", tempDir);

    // Verify original __tests__ was restored
    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.readFileSync(origTestsFile, "utf8")).toBe("console.log('original test');");
  });

  it("Scenario F: Pre-existing state directory collision causes setup to abort safely without data loss", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");
    fs.mkdirSync(path.join(tempDir, ".test_workspace_state"));

    const output = runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
    });

    expect(output).toContain("already exists");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("Scenario G: Cleanup without valid state directory safely skips deletion to prevent data loss", () => {
    const nodeModules = path.join(tempDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "sentinel.txt"), "keep-me");

    // Run cleanup without setup (no .test_workspace_state)
    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(nodeModules, "sentinel.txt"))).toBe(true);
  });

  it("Standard happy path: setup and cleanup work end-to-end", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "nested", "file.txt"), "utf8")).toBe("nested-content");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("Idempotency: Cleanup runs twice safely without error or data loss", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);
    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");

    // Second cleanup call
    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });
});
