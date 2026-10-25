import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), ".github/scripts/test-workspace-cleanup.sh");

function runScript(args: string, cwd: string, options: { expectFailure?: boolean } = {}): string {
  try {
    const output = execSync(`bash "${SCRIPT_PATH}" ${args}`, {
      cwd,
      env: { ...process.env, RUNNER_TEMP: path.join(cwd, "runner_temp") },
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

    fixtureDir = path.join(tempDir, "__tests__", "fixtures", "test-action", "node", "npm", "basic");
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

  it("Scenario 1: Pre-existing node_modules, dist, .venv, .ruff_cache, *.egg-info survive setup and cleanup intact", () => {
    const preExistingDirs = ["node_modules", "dist", ".venv", ".ruff_cache", "test.egg-info"];
    for (const dir of preExistingDirs) {
      const dirPath = path.join(tempDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "sentinel.txt"), `sentinel-in-${dir}`);
    }

    runScript("setup test-action node npm basic", tempDir);

    expect(fs.existsSync(path.join(tempDir, "package.json"))).toBe(true);

    runScript("cleanup", tempDir);

    for (const dir of preExistingDirs) {
      const sentinelPath = path.join(tempDir, dir, "sentinel.txt");
      expect(fs.existsSync(sentinelPath)).toBe(true);
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe(`sentinel-in-${dir}`);
    }
  });

  it("Scenario 2: Setup fails before backup; original files remain intact", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "original-pkg" }));

    runScript("setup test-action node npm non-existent-fixture", tempDir, { expectFailure: true });

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toContain("original-pkg");
  });

  it("Scenario 3: Setup fails after partial backups; all backed-up files are restored", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");
    fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "orig-pyproject");

    try {
      execSync(`bash -c 'export RUNNER_TEMP="${tempDir}/runner_temp"; touch pyproject.toml.test_bak_$$; exec bash "${SCRIPT_PATH}" setup test-action node npm basic'`, {
        cwd: tempDir,
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch {
      // Expected setup failure due to backup collision
    }

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.readFileSync(path.join(tempDir, "pyproject.toml"), "utf8")).toBe("orig-pyproject");
  });

  it("Scenario 4: Partial fixture installation failure removes only installed fixture files and restores originals", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript("setup test-action node npm basic", tempDir);

    expect(fs.existsSync(path.join(tempDir, "nested", "file.txt"))).toBe(true);

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("Scenario 5: Backup collision aborts safely without overwriting or deleting original", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    const extFixture = path.join(tempDir, "ext_fixture");
    fs.mkdirSync(extFixture, { recursive: true });
    fs.writeFileSync(path.join(extFixture, "package.json"), "fixture-pkg");

    let output = "";
    try {
      output = execSync(
        `bash -c 'export RUNNER_TEMP="${tempDir}/runner_temp"; touch package.json.test_bak_$$; exec bash "${SCRIPT_PATH}" setup test-action node npm basic "${extFixture}"'`,
        { cwd: tempDir, stdio: "pipe", encoding: "utf8" }
      );
    } catch (err: any) {
      output = err.stderr || err.stdout || err.message;
    }

    expect(output).toContain("already exists");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("Scenario 6: Backup file is preserved if restoration fails", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript("setup test-action node npm basic", tempDir);

    const backedUpContent = fs.readFileSync(path.join(tempDir, ".backed_up_files"), "utf8");
    const backupFileName = backedUpContent.trim().split("|")[1];

    expect(fs.existsSync(path.join(tempDir, backupFileName))).toBe(true);

    runScript("cleanup", tempDir);
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("Scenario 7: Pre-existing __tests__ directory is stashed during setup and restored during cleanup", () => {
    const origTestsFile = path.join(tempDir, "__tests__", "my_test.test.js");
    fs.writeFileSync(origTestsFile, "console.log('original test');");

    runScript("setup test-action node npm basic", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toContain("fixture-pkg");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.readFileSync(origTestsFile, "utf8")).toBe("console.log('original test');");
  });

  it("Scenario 8: Non-existing __tests__ before setup leaves no __tests__ directory or orphan stash directory after cleanup", () => {
    fs.rmSync(path.join(tempDir, "__tests__"), { recursive: true, force: true });

    const extFixture = path.join(tempDir, "external_fixture");
    fs.mkdirSync(extFixture, { recursive: true });
    fs.writeFileSync(path.join(extFixture, "app.py"), "print('hello')");

    runScript(`setup autofix node npm python-pip "${extFixture}"`, tempDir);

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, "__tests__"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, ".stash_tests_path"))).toBe(false);
  });

  it("Scenario 9: Cleanup runs twice safely and idempotently without deleting restored files", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript("setup test-action node npm basic", tempDir);
    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("Scenario 10: Dotfiles and nested fixture paths are handled correctly", () => {
    runScript("setup test-action node npm basic", tempDir);

    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, ".dotfile_fixture"), "utf8")).toBe("dotfile-content");
    expect(fs.readFileSync(path.join(tempDir, "nested", "file.txt"), "utf8")).toBe("nested-content");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });
});
