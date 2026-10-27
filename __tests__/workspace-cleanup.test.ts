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

  it("preserves recovery state and exits nonzero when restoration fails", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const output = runScript("cleanup", tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_RESTORE: "1" },
    });

    expect(output).toContain("Error:");
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

  it("rejects malformed manifests and exits nonzero before deleting workspace content", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    const preExistingDir = path.join(tempDir, "node_modules");
    fs.mkdirSync(preExistingDir, { recursive: true });
    fs.writeFileSync(path.join(preExistingDir, "sentinel.txt"), "sentinel");

    // Write malformed path with traversal in installed_fixture_files
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "../unsafe_path\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Unsafe deletion refused, pre-existing path preserved, state dir preserved
    expect(fs.existsSync(path.join(preExistingDir, "sentinel.txt"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects forged entry in installed_fixture_files, exits nonzero, and preserves pre-existing root file", () => {
    const preExistingFile = path.join(tempDir, "pre_existing_unrelated.txt");
    fs.writeFileSync(preExistingFile, "do-not-delete");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");
    // Forge installed_fixture_files by adding preExistingFile to it
    fs.appendFileSync(path.join(stateDir, "installed_fixture_files"), "pre_existing_unrelated.txt\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Forged entry fails ownership validation against fixture_ownership_manifest: pre-existing file must NOT be deleted!
    expect(fs.existsSync(preExistingFile)).toBe(true);
    expect(fs.readFileSync(preExistingFile, "utf8")).toBe("do-not-delete");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects mixed valid and forged entries in installed_fixture_files without deleting valid entries and exits nonzero", () => {
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");
    const preExistingFile = path.join(tempDir, "forged.txt");
    fs.writeFileSync(preExistingFile, "forged-content");

    // Append forged entry to installed_fixture_files which also has valid installed items (e.g., package.json)
    fs.appendFileSync(path.join(stateDir, "installed_fixture_files"), "forged.txt\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Validation fails closed, so neither forged.txt nor legitimate installed items are deleted, state dir preserved
    expect(fs.existsSync(preExistingFile)).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when required recovery metadata file is missing for reached phase", () => {
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");

    // Test missing stash.info after successful setup (phase PHASE_COMPLETE)
    fs.rmSync(path.join(stateDir, "stash.info"));

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Cleanup fails closed, state directory and workspace contents preserved
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when each phase-mandatory metadata file is removed", () => {
    const metadataFiles = [
      "stash.info",
      "snapshot.status",
      "snapshot_pre_existing_items",
      "backed_up_files",
      "installed_fixture_files",
      "fixture_ownership_manifest",
    ];

    for (const metadataFile of metadataFiles) {
      const subTempDir = fs.mkdtempSync(path.join(process.cwd(), "tmp_test_cleanup_sub_"));
      fs.mkdirSync(path.join(subTempDir, "runner_temp"), { recursive: true });

      try {
        runScript(`setup autofix node npm python-pip "${fixtureDir}"`, subTempDir);
        const subStateDir = path.join(subTempDir, ".test_workspace_state");

        fs.rmSync(path.join(subStateDir, metadataFile));

        const output = runScript("cleanup", subTempDir, { expectFailure: true });

        expect(output).toContain("Error:");
        expect(fs.existsSync(subStateDir)).toBe(true);
      } finally {
        fs.rmSync(subTempDir, { recursive: true, force: true });
      }
    }
  });

  it("fails closed and exits nonzero when phase.status has an unknown phase value", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_UNKNOWN_INVALID\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: State directory exists with invalid or unknown SETUP_PHASE");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when phase.status has conflicting status entries", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "phase.status"),
      "SETUP_PHASE=PHASE_INIT\nSETUP_PHASE=PHASE_COMPLETE\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Conflicting phase status entries in phase.status");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("handles crash boundary during stashing phase safely without losing stashed __tests__", () => {
    const origTestsFile = path.join(tempDir, "__tests__", "my_test.test.js");
    fs.mkdirSync(path.dirname(origTestsFile), { recursive: true });
    fs.writeFileSync(origTestsFile, "test-code");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_STASH: "1" },
    });

    // Verify phase was recorded as PHASE_STASHED
    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.readFileSync(path.join(stateDir, "phase.status"), "utf8")).toContain("PHASE_STASHED");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.readFileSync(origTestsFile, "utf8")).toBe("test-code");
  });

  it("rejects nested paths in installed_fixture_files before deleting any fixture files", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "installed.txt\n");

    const installedFile = path.join(tempDir, "installed.txt");
    fs.writeFileSync(installedFile, "installed-data");

    // installed_fixture_files has valid line 1, but nested line 2
    fs.writeFileSync(
      path.join(stateDir, "installed_fixture_files"),
      "installed.txt\nnested/dir/file.txt\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Nested path rejected, line 1 installed.txt NOT deleted!
    expect(fs.existsSync(installedFile)).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("preserves tests directory when stash.info contains missing or invalid tests_existed_before_setup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_STASHED\n");

    const testsDir = path.join(tempDir, "__tests__");
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, "my_test.test.js"), "content");

    // Write stash.info with invalid tests_existed_before_setup value
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${path.join(tempDir, "runner_temp", "tests_stash_123")}\ntests_existed_before_setup=invalid_value\n`
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    expect(fs.existsSync(path.join(testsDir, "my_test.test.js"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects out-of-bounds or malformed stash paths during cleanup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_STASHED\n");

    // Write stash.info with an out-of-bounds stash path (e.g. /etc/tests_stash_123)
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=/etc/tests_stash_123\ntests_existed_before_setup=true\n`
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // State directory preserved for recovery because stash path validation failed
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects a stash path that is a symbolic link during cleanup", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_STASHED\n");

    const runnerTemp = path.join(tempDir, "runner_temp");
    const realDir = path.join(runnerTemp, "tests_stash_real_123");
    fs.mkdirSync(realDir, { recursive: true });

    const symlinkStash = path.join(runnerTemp, "tests_stash_symlink_123");
    fs.symlinkSync(realDir, symlinkStash);

    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${symlinkStash}\ntests_existed_before_setup=true\n`
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
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
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Write malformed backup mapping (missing pipe delimiter or absolute path)
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "/etc/passwd|package.json.test_bak_123\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects unallowed root items or mismatched backup patterns in backed_up_files manifest", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Write unallowed root item or mismatched backup filename
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "unallowed_file.txt|package.json.test_bak_123\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("atomically refuses restoration if any mapping in backed_up_files is invalid", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Create a valid backup file for package.json and modified package.json
    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_100"), "backup-pkg");

    // backed_up_files has valid line 1, but invalid line 2 (unallowed root item)
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100\nmalicious_file.txt|malicious_file.txt.test_bak_100\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Atomic validation fails on line 2, so line 1 IS NOT restored or mutated!
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(path.join(tempDir, "package.json.test_bak_100"))).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects backup filename that matches via regex dot wildcard instead of literal dot", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "packageXjson.test_bak_100"), "backup-pkg");

    // backed_up_files mapping tries to map orig_item 'package.json' to 'packageXjson.test_bak_100'
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|packageXjson.test_bak_100\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    // Literal check fails (X != .), package.json is NOT restored/mutated, state is preserved
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects duplicate original or backup item entries in backed_up_files", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_100"), "backup-pkg-1");
    fs.writeFileSync(path.join(tempDir, "package.json.test_bak_200"), "backup-pkg-2");

    // Duplicate orig_item "package.json"
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100\npackage.json|package.json.test_bak_200\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects nested backup paths in backed_up_files manifest", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");

    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_100/nested\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
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

  it("recovers safely from interruption after moving original item but before recording completion", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_BACKUP_MOVE: "1" },
    });

    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.existsSync(stateDir)).toBe(true);

    // Cleanup uses journal log to locate pending backup and restore package.json
    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, "package.json"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("recovers safely from interruption after copying fixture item but before recording installation", () => {
    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_COPY_FILE: "1" },
    });

    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.existsSync(stateDir)).toBe(true);

    // Cleanup uses journal log and fixture ownership manifest to clean up pending installed files
    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, ".dotfile_fixture"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "nested"))).toBe(false);
  });

  it("fails closed and exits nonzero when a backup manifest entry backup file is missing", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "current-pkg");

    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_BACKED_UP\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Missing backup file package.json.test_bak_999
    fs.writeFileSync(
      path.join(stateDir, "backed_up_files"),
      "package.json|package.json.test_bak_999\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Expected backup file 'package.json.test_bak_999' for 'package.json' is missing");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("current-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("rejects setup and exits nonzero when fixture item collides with root item outside ROOT_ITEMS allowlist", () => {
    const unallowedFixtureDir = path.join(tempDir, "unallowed_fixture");
    fs.mkdirSync(unallowedFixtureDir, { recursive: true });
    fs.writeFileSync(path.join(unallowedFixtureDir, "unallowed_root_file.txt"), "fixture-content");

    fs.writeFileSync(path.join(tempDir, "unallowed_root_file.txt"), "workspace-content");

    const output = runScript(`setup autofix node npm python-pip "${unallowedFixtureDir}"`, tempDir, {
      expectFailure: true,
    });

    expect(output).toContain("collides with existing workspace item but is not in ROOT_ITEMS allowlist");
    // Original workspace file is untouched and no backup file created!
    expect(fs.readFileSync(path.join(tempDir, "unallowed_root_file.txt"), "utf8")).toBe("workspace-content");
    expect(fs.readdirSync(tempDir).filter((f) => f.includes("test_bak"))).toHaveLength(0);
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

  it("handles repeated cleanup idempotently when __tests__ is restored but stash path removal was interrupted", () => {
    const origTestsFile = path.join(tempDir, "__tests__", "my_test.test.js");
    fs.mkdirSync(path.dirname(origTestsFile), { recursive: true });
    fs.writeFileSync(origTestsFile, "console.log('original test');");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");
    const stashInfo = fs.readFileSync(path.join(stateDir, "stash.info"), "utf8");
    const stashPathMatch = stashInfo.match(/stash_tests_path=(.*)/);
    expect(stashPathMatch).not.toBeNull();
    const stashPath = stashPathMatch![1].trim();

    // First cleanup interrupted after moving __tests__ back but before stash path deletion
    runScript("cleanup", tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_AFTER_MV_STASH: "1" },
    });

    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.existsSync(stashPath)).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(true);

    // Second cleanup completes restoration idempotently
    runScript("cleanup", tempDir);

    expect(fs.existsSync(origTestsFile)).toBe(true);
    expect(fs.existsSync(stashPath)).toBe(false);
    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("handles repeated cleanup idempotently when tests_existed_before_setup=false and stash is already removed", () => {
    runScript("setup pages node npm consumer-integration consumer-project", tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");
    const stashInfo = fs.readFileSync(path.join(stateDir, "stash.info"), "utf8");
    const stashPathMatch = stashInfo.match(/stash_tests_path=(.*)/);
    expect(stashPathMatch).not.toBeNull();
    const stashPath = stashPathMatch![1].trim();

    // Manually delete empty stash path before cleanup
    fs.rmSync(stashPath, { recursive: true, force: true });

    runScript("cleanup", tempDir);

    expect(fs.existsSync(stateDir)).toBe(false);
  });

  it("fails closed and exits nonzero when journal contains unknown event type", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(stateDir, "journal.log"), "UNKNOWN_EVENT_TYPE|arg1|arg2\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Unknown record type 'UNKNOWN_EVENT_TYPE' in journal.log");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when journal contains invalid field count or malformed line", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // BACKUP_DONE should have 3 fields (2 pipes)
    fs.writeFileSync(path.join(stateDir, "journal.log"), "BACKUP_DONE|package.json\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Malformed 'BACKUP_DONE' entry in journal.log");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when journal contains unsafe or nested path", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(stateDir, "journal.log"), "INSTALL_PENDING|../unsafe_path\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Unsafe path in journal.log 'INSTALL_PENDING' record");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when journal contains mismatched backup filename prefix", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(stateDir, "journal.log"), "BACKUP_DONE|package.json|package_invalid_bak_123\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error: Mismatched backup filename prefix in journal.log");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when RESTORE_DONE path in journal for __tests__ does not match stash.info", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    const runnerTemp = path.join(tempDir, "runner_temp");
    const validStash = path.join(runnerTemp, "tests_stash_123");
    fs.mkdirSync(path.join(validStash, "__tests__"), { recursive: true });

    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${validStash}\ntests_existed_before_setup=true\n`
    );
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Mismatched stash path in RESTORE_DONE
    const mismatchedPath = path.join(runnerTemp, "tests_stash_mismatched_999", "__tests__");
    fs.writeFileSync(path.join(stateDir, "journal.log"), `RESTORE_DONE|__tests__|${mismatchedPath}\n`);

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("does not match stash.info stashed path");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when RESTORE_DONE is logged for __tests__ but neither stashed nor workspace __tests__ exists", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    const runnerTemp = path.join(tempDir, "runner_temp");
    const validStash = path.join(runnerTemp, "tests_stash_123");

    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${validStash}\ntests_existed_before_setup=true\n`
    );
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    const expectedStashed = path.join(validStash, "__tests__");
    fs.writeFileSync(path.join(stateDir, "journal.log"), `RESTORE_DONE|__tests__|${expectedStashed}\n`);

    // Ensure neither workspace __tests__ nor stashed __tests__ exists
    if (fs.existsSync(path.join(tempDir, "__tests__"))) {
      fs.rmSync(path.join(tempDir, "__tests__"), { recursive: true, force: true });
    }

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("neither stashed directory nor workspace '__tests__' exists");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when backup filename has non-numeric suffix in journal", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(stateDir, "journal.log"), "BACKUP_DONE|package.json|package.json.test_bak_nonnumeric\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Mismatched backup filename suffix in journal.log");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when RESTORE_DONE is logged for root item but neither original nor backup file exists", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(stateDir, "journal.log"), "RESTORE_DONE|package.json|package.json.test_bak_123\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("neither original item nor backup file 'package.json.test_bak_123' exists");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when manifest maps to a backup file that is missing and journal has conflicting RESTORE_DONE backup path", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "modified-pkg");

    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "package.json|package.json.test_bak_123\n");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    // Journal records RESTORE_DONE for a DIFFERENT backup path package.json.test_bak_999
    fs.writeFileSync(path.join(stateDir, "journal.log"), "RESTORE_DONE|package.json|package.json.test_bak_999\n");

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("conflicts with manifest mapping");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("modified-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("fails closed and exits nonzero when duplicate RESTORE_DONE entries for same item exist in journal", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_COMPLETE\n");
    fs.writeFileSync(path.join(stateDir, "stash.info"), "tests_existed_before_setup=false\n");
    fs.writeFileSync(path.join(stateDir, "snapshot.status"), "SNAPSHOT_STATUS=complete\n");
    fs.writeFileSync(path.join(stateDir, "snapshot_pre_existing_items"), "");
    fs.writeFileSync(path.join(stateDir, "backed_up_files"), "");
    fs.writeFileSync(path.join(stateDir, "installed_fixture_files"), "");
    fs.writeFileSync(path.join(stateDir, "fixture_ownership_manifest"), "");

    fs.writeFileSync(path.join(tempDir, "package.json"), "workspace-pkg");

    fs.writeFileSync(
      path.join(stateDir, "journal.log"),
      "RESTORE_DONE|package.json|package.json.test_bak_123\nRESTORE_DONE|package.json|package.json.test_bak_456\n"
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Duplicate RESTORE_DONE entry for 'package.json'");
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("workspace-pkg");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("remains safe when cleanup is invoked twice", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);
    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg");
  });

  it("handles pre-existing files and directories with spaces in their names correctly", () => {
    const spaceDir = path.join(tempDir, "dir with spaces");
    fs.mkdirSync(spaceDir, { recursive: true });
    const spaceFile = path.join(spaceDir, "file with spaces.txt");
    fs.writeFileSync(spaceFile, "content with spaces");

    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg-spaces");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    runScript("cleanup", tempDir);

    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg-spaces");
    expect(fs.readFileSync(spaceFile, "utf8")).toBe("content with spaces");
  });

  it("recovers safely when setup fails before backup move occurs (INJECT_FAILURE_BEFORE_BACKUP_MOVE)", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "orig-pkg-before-move");

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir, {
      expectFailure: true,
      env: { INJECT_FAILURE_BEFORE_BACKUP_MOVE: "1" },
    });

    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.existsSync(stateDir)).toBe(true);

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, "package.json"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe("orig-pkg-before-move");
  });

  it("rejects stash path that points outside approved temporary directory even if inside runner temp subfolder", () => {
    const stateDir = path.join(tempDir, ".test_workspace_state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "phase.status"), "SETUP_PHASE=PHASE_STASHED\n");

    const outsidePath = "/tmp/unapproved_outside_dir/tests_stash_999";
    fs.writeFileSync(
      path.join(stateDir, "stash.info"),
      `stash_tests_path=${outsidePath}\ntests_existed_before_setup=true\n`
    );

    const output = runScript("cleanup", tempDir, { expectFailure: true });

    expect(output).toContain("Error:");
    expect(fs.existsSync(stateDir)).toBe(true);
  });

  it("handles scenario where pre-existing __tests__ is absent cleanly without error", () => {
    expect(fs.existsSync(path.join(tempDir, "__tests__"))).toBe(false);

    runScript(`setup autofix node npm python-pip "${fixtureDir}"`, tempDir);

    const stateDir = path.join(tempDir, ".test_workspace_state");
    expect(fs.readFileSync(path.join(stateDir, "stash.info"), "utf8")).toContain("tests_existed_before_setup=false");

    runScript("cleanup", tempDir);

    expect(fs.existsSync(path.join(tempDir, "__tests__"))).toBe(false);
  });
});
