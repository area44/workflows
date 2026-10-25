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
  let output = "";
  let failed = false;

  try {
    output = execSync(`bash "${SCRIPT_PATH}" ${args} 2>&1`, {
      cwd,
      env: {
        ...process.env,
        RUNNER_TEMP: path.join(cwd, "runner_temp"),
        ...options.env,
      },
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (error: any) {
    failed = true;
    output = error.stderr || error.stdout || error.message;
  }

  if (options.expectFailure && !failed) {
    throw new Error(`Expected script to fail but it exited successfully (code 0) with output: ${output}`);
  }
  if (!options.expectFailure && failed) {
    throw new Error(`Script failed unexpectedly: ${output}`);
  }

  return output;
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

  it("test helper fails explicitly when an expected failure exits with code 0", () => {
    expect(() => {
      runScript("cleanup", tempDir, { expectFailure: true });
    }).toThrow("Expected script to fail but it exited successfully");
  });

  it("preserves pre-existing paths when setup fails before snapshot initialization", () => {
    const preExistingDirs = ["node_modules", "dist", ".venv", ".ruff_cache", "test.egg-info"];
    for (const dir of preExistingDirs) {
      const dirPath = path.join(tempDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "sentinel.txt"), `sentinel-in-${dir}`);
    }

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_BEFORE_SNAPSHOT: "1" },
    });

    runScript("cleanup", tempDir);

    for (const dir of preExistingDirs) {
      const sentinelPath = path.join(tempDir, dir, "sentinel.txt");
      expect(fs.existsSync(sentinelPath)).toBe(true);
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe(`sentinel-in-${dir}`);
    }
  });

  it("preserves generated paths when snapshot creation fails", () => {
    const preExistingDirs = ["node_modules", "dist", ".venv"];
    for (const dir of preExistingDirs) {
      const dirPath = path.join(tempDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "sentinel.txt"), `sentinel-in-${dir}`);
    }

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_IN_SNAPSHOT: "1" },
    });

    runScript("cleanup", tempDir);

    for (const dir of preExistingDirs) {
      const sentinelPath = path.join(tempDir, dir, "sentinel.txt");
      expect(fs.existsSync(sentinelPath)).toBe(true);
      expect(fs.readFileSync(sentinelPath, "utf8")).toBe(`sentinel-in-${dir}`);
    }
  });

  it("restores original files after partial fixture installation", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");
    const unrelatedFile = path.join(tempDir, "unrelated.txt");
    fs.writeFileSync(unrelatedFile, "unrelated-data");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_IN_COPY: "1" },
    });

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.readFileSync(unrelatedFile, "utf8")).toBe("unrelated-data");
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("preserves recovery state when restoration fails", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const output = runScript("cleanup", tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_RESTORE: "1" },
    });

    expect(output).toContain("Injected failure restoring");
    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.existsSync(stateDir)).toBe(true);
    expect(fs.existsSync(path.join(stateDir, "backed_up_files"))).toBe(true);
  });

  it("restores the original tests directory when setup fails after stashing", () => {
    const origTestsFile = path.join(tempDir, "__tests__", "my_test.test.js");
    fs.mkdirSync(path.dirname(origTestsFile), { recursive: true });
    fs.writeFileSync(origTestsFile, "console.log('original test');");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_STASH: "1" },
    });

    runScript("cleanup", tempDir);

    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.readFileSync(origTestsFile, "utf8")).toBe("console.log('original test');");
  });

  it("rejects setup when the state directory already exists", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");
    fs.mkdirSync(path.join(tempDir, ".test_workspace_state"));

    const output = runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
    });

    expect(output).toContain("already exists");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("preserves workspace data when cleanup state is missing", () => {
    const nodeModules = path.join(tempDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "sentinel.txt"), "keep-me");

    const output = runScript("cleanup", tempDir);

    expect(output).toContain("missing or incomplete");
    expect(fs.existsSync(path.join(nodeModules, "sentinel.txt"))).toBe(true);
  });

  it("rejects malformed manifests before deleting workspace content", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");

    const preExistingDir = path.join(tempDir, "node_modules");
    fs.mkdirSync(preExistingDir, { recursive: true });
    fs.writeFileSync(path.join(preExistingDir, "sentinel.txt"), "sentinel");

    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "../unsafe_path\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Unsafe item in installed_fixture_files");
    expect(fs.existsSync(path.join(preExistingDir, "sentinel.txt"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("does not delete generated paths when snapshot metadata is incomplete or inconsistent", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=incomplete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");

    const generatedDir = path.join(tempDir, "node_modules");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(path.join(generatedDir, "generated.txt"), "gen");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Snapshot is missing, incomplete, or state is invalid");
    expect(fs.existsSync(path.join(generatedDir, "generated.txt"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("preserves tests directory when stash metadata is invalid", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    const testsDir = path.join(tempDir, "__tests__");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, "my_test.test.js"), "content");

    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${path.join(tempDir, "runner_temp", "tests_stash_123")}\ntests_existed_before_setup=invalid_value\n`
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Invalid tests_existed_before_setup value");
    expect(fs.existsSync(path.join(testsDir, "my_test.test.js"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("does not delete unrelated tests content when state claims tests directory did not exist before setup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    const testsDir = path.join(tempDir, "__tests__");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, "unrelated.test.js"), "unrelated");

    // Malformed stash info missing required keys
    fs.writeFileSync(path.join(stateDir, "stash.info"), "malformed_key=value\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Invalid or missing stash.info");
    expect(fs.existsSync(path.join(testsDir, "unrelated.test.js"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects unsafe paths and invalid backup mappings before restoration", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "/etc/passwd|package.json.test_bak_123\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Backup original item must be top-level root path");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("preserves original files when backup is missing or mapping is inconsistent", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "package.json|package.json.test_bak_99999\n");
    fs.writeFileSync(path.join(tempDir, "package.json"), "current-content");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Missing backup destination 'package.json.test_bak_99999'");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("current-content");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("executes setup and cleanup end-to-end cleanly", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "nested", "file.txt"), "utf8")).toBe("nested-content");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("remains safe when cleanup is invoked twice", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);
    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });
});
