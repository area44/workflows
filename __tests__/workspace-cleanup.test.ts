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
    output = execSync(`bash "${SCRIPT_PATH}" ${args}`, {
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

    runScript("cleanup", tempDir, { env: { INJECT_FAILURE_RESTORE: "1" } });

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

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(nodeModules, "sentinel.txt"))).toBe(true);
  });

  it("rejects malformed manifests before deleting workspace content", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");

    const preExistingDir = path.join(tempDir, "node_modules");
    fs.mkdirSync(preExistingDir, { recursive: true });
    fs.writeFileSync(path.join(preExistingDir, "sentinel.txt"), "sentinel");

    // Write malformed path with traversal in installed_fixture_files
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "../unsafe_path\n");

    runScript("cleanup", tempDir);

    // Unsafe deletion refused, pre-existing path preserved, state dir preserved
    expect(fs.existsSync(path.join(preExistingDir, "sentinel.txt"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects nested paths in installed_fixture_files before deleting any fixture files", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    const installedFile = path.join(tempDir, "installed.txt");
    fs.writeFileSync(installedFile, "installed-data");

    // installed_fixture_files has valid line 1, but nested line 2
    fs.writeFileSync(
      path.join(stateDir, "installed_fixture_files"),
      "installed.txt\nnested/dir/file.txt\n"
    );

    runScript("cleanup", tempDir);

    // Nested path rejected, line 1 installed.txt NOT deleted!
    expect(fs.existsSync(installedFile)).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("preserves tests directory when stash.info contains missing or invalid tests_existed_before_setup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    const testsDir = path.join(tempDir, "__tests__");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, "my_test.test.js"), "content");

    // Write stash.info with invalid tests_existed_before_setup value
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${path.join(tempDir, "runner_temp", "tests_stash_123")}\ntests_existed_before_setup=invalid_value\n`
    );

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(testsDir, "my_test.test.js"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects out-of-bounds or malformed stash paths during cleanup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    // Write stash.info with an out-of-bounds stash path (e.g. /etc/tests_stash_123)
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=/etc/tests_stash_123\ntests_existed_before_setup=true\n`
    );

    runScript("cleanup", tempDir);

    // State directory preserved for recovery because stash path validation failed
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects a stash path that is a symbolic link during cleanup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    const runnerTemp = path.join(tempDir, "runner_temp");
    const realDir = path.join(runnerTemp, "tests_stash_real_123");
    fs.mkdirSync(realDir, { recursive: true });

    const symlinkStash = path.join(runnerTemp, "tests_stash_symlink_123");
    fs.symlinkSync(realDir, symlinkStash);

    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${symlinkStash}\ntests_existed_before_setup=true\n`
    );

    runScript("cleanup", tempDir);

    // Symlink stash refused, state directory preserved for recovery
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("never reuses or deletes pre-existing PID-based stash directory", () => {
    const runnerTemp = path.join(tempDir, "runner_temp");
    const preExistingStash = path.join(runnerTemp, "tests_stash_99999");
    fs.mkdirSync(preExistingStash, { recursive: true });
    fs.writeFileSync(path.join(preExistingStash, "sentinel.txt"), "donotdelete");

    runScript("setup pages node npm consumer-integration consumer-project", tempDir);

    // Pre-existing stash directory is untouched
    expect(fs.existsSync(path.join(preExistingStash, "sentinel.txt"))).toBe(true);

    runScript("cleanup", tempDir);

    // Pre-existing stash directory remains intact after cleanup
    expect(fs.existsSync(path.join(preExistingStash, "sentinel.txt"))).toBe(true);
  });

  it("rejects unsafe paths or invalid backup mappings in backed_up_files manifest", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    // Write malformed backup mapping (missing pipe delimiter or absolute path)
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "/etc/passwd|package.json.test_bak_123\n");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects unallowed root items or mismatched backup patterns in backed_up_files manifest", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    // Write unallowed root item or mismatched backup filename
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "unallowed_file.txt|package.json.test_bak_123\n");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("atomically refuses restoration if any mapping in backed_up_files is invalid", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    // Create a valid backup file for package.json and modified package.json
    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_100"), "backup-pkg");

    // backed_up_files has valid line 1, but invalid line 2 (unallowed root item)
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100\nmalicious_file.txt|malicious_file.txt.test_bak_100\n"
    );

    runScript("cleanup", tempDir);

    // Atomic validation fails on line 2, so line 1 IS NOT restored or mutated!
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(path.join(tempDir, "package.json.test_bak_100"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects backup filename that matches via regex dot wildcard instead of literal dot", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "packageXjson.test_bak_100"), "backup-pkg");

    // backed_up_files mapping tries to map orig_item 'package.json' to 'packageXjson.test_bak_100'
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|packageXjson.test_bak_100\n"
    );

    runScript("cleanup", tempDir);

    // Literal check fails (X != .), package.json is NOT restored/mutated, state is preserved
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects duplicate original or backup item entries in backed_up_files", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_100"), "backup-pkg-1");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_200"), "backup-pkg-2");

    // Duplicate orig_item "package.json"
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100\npackage.json|package.json.test_bak_200\n"
    );

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects nested backup paths in backed_up_files manifest", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");

    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100/nested\n"
    );

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
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

  it("executes setup and cleanup for dynamic consumer project cleanly", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript("setup pages node npm consumer-integration consumer-project", tempDir);

    expect(fs.existsSync(path.join(tempDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "index.html"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "index.html"), "utf8")).toContain("AREA44 Workflows Consumer Project");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
    expect(fs.existsSync(path.join(tempDir, "index.html"))).toBe(false);
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
