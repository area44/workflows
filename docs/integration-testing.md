# Consumer Integration Testing Guide

This document explains the purpose, architecture, boundaries, execution, and fixture consolidation policy of integration testing for `area44/workflows` using dynamically generated consumer project fixtures.

## Overview & Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly when consumed by real projects—beyond isolated unit tests—`area44/workflows` generates consumer projects dynamically in temporary directories using a single canonical generator module:

- **Canonical Generator Script (`.github/scripts/generate-consumer-project.js`)**: Single source of truth defining file contents, templates, CLI target validation, and non-empty/overwrite safeguards. Requires an explicit target directory argument (`generate-consumer-project.js <target-directory>`).
- **TypeScript Test Helper (`__tests__/helpers/consumer-project.ts`)**: Re-exports `createConsumerProject` and `generateConsumerProjectFiles` directly from the canonical JS generator module so unit tests and Node scripts share identical generation logic without drift.

### Target Directory & Overwrite Protection

To prevent accidental data loss:

- **Explicit Target Required**: The CLI refuses to execute without an explicit target directory argument (forbidding implicit `process.cwd()` execution).
- **`allowNonEmpty` Option / `--allow-non-empty` Flag**: Allows generating into a non-empty directory if pre-existing files are unrelated (e.g. `pre_existing.txt`).
- **`overwrite` Option / `--overwrite` Flag**: Explicitly permits overwriting files whose names collide with generated outputs (`package.json`, `package-lock.json`, `pyproject.toml`, `requirements.txt`, `index.html`, `main.py`). Even when `allowNonEmpty` is true, colliding files will NOT be overwritten unless `overwrite` is explicitly enabled.

### Generated Project Structure

- **`package.json`**: Defines standard Node.js package metadata, scripts (`"build": "mkdir -p dist && cp index.html dist/index.html"`, `lint`, `format`), and package manager declaration (`npm@10.8.2`).
- **`package-lock.json`**: Lockfile for reproducible npm installation.
- **`index.html`**: HTML static asset source containing `"AREA44 Workflows Consumer Project"`.
- **`pyproject.toml`**: Python project configuration with `ruff` dependency specification.
- **`requirements.txt`**: Pinned Python dependency manifest (`ruff==0.17.2`).
- **`main.py`**: Python source code file to exercise Python linting and formatting workflows.

The generated project represents a real-world multi-language (JS + Python) consumer application without committing static fixture files to the repository.

---

## Fixture Consolidation Policy

All fixtures across the repository are audited and maintained under the following consolidation policy:

1. **Unique and Necessary**: Specialized fixtures (`pages/*`, `autofix/*`, `vite-plus/*`) representing distinct toolchains, package managers, lockfiles, or failure modes are retained.
2. **Dynamic Generation**: Repeated or general-purpose consumer application fixtures are generated dynamically in unique temporary directories rather than committed as static files.
3. **Obsolete Fixtures**: Committed static consumer fixtures (`__tests__/fixtures/consumer-project/` and `__tests__/fixtures/pages/node/npm/consumer/`) have been removed after verifying full test migration to dynamic project factory functions.

---

## Testing Boundaries & Architecture

Integration validation is divided into two distinct levels to balance speed and execution fidelity:

### 1. Module-Level Integration Tests (`__tests__/integration-consumer.test.ts`)

- **Execution Boundary**: Directly imports TypeScript source modules (`src/resolve-environment.ts`, `src/pages/site-variables.ts`, `src/pages/build-command.ts`, `src/javascript-env.ts`) in Vitest via `vite-plus/test`.
- **Purpose**: Fast local execution validating environment detection, output formatting, site variable calculations, custom command parsing, and error diagnostics against dynamically generated consumer projects in temporary directories (`os.tmpdir()`).

### 2. Action-Level Composite CI Matrix (`.github/workflows/test-actions.yml`)

- **Execution Boundary**: Invokes the local composite actions (`./pages` and `./autofix`) in GitHub Actions runners.
- **Purpose**: End-to-end execution of the composite action pipeline:
  - **Workspace Installation**: `.github/scripts/test-workspace-cleanup.sh setup` generates a dynamic consumer project into an isolated temporary staging directory created safely via `mktemp -d` while stashing `__tests__` into an exclusively owned `mktemp -d` stash directory (preventing test files from polluting matrix runs).
  - **Action Invocation**: Runs `./pages` and `./autofix` using local checkout code against the generated project.
  - **Output & Artifact Verification**: Validates step outputs (`package-manager`, `runtime`, `toolchain`, `has-js-project`, `has-python-source`, etc.) and asserts that the build copies the source file to `dist/index.html` containing the consumer fixture marker (`"AREA44 Workflows Consumer Project"`).
  - **Workspace Restoration**: `.github/scripts/test-workspace-cleanup.sh cleanup` restores original workspace files and stashed directories safely.

---

## Running Integration Tests Locally

### Run Full Test Suite

```bash
npm test
```

### Run Consumer Generator Tests

```bash
npm test __tests__/generate-consumer-project.test.ts
```

### Run Consumer Integration Module Tests

```bash
npm test __tests__/integration-consumer.test.ts
```

### Run Workspace Cleanup Script Validation

```bash
npm test __tests__/workspace-cleanup.test.ts
```

---

## Temporary Directory Ownership & Atomic Manifest Guarantees

All temporary consumer projects created during unit/integration tests and CI matrix runs enforce strict ownership, atomic manifest pre-validation, and deterministic cleanup:

- **Exclusive Staging Ownership**: `.github/scripts/test-workspace-cleanup.sh` uses `mktemp -d "${TMP_FIX_BASE}/fixture_copy_XXXXXX"` to create unique staging directories with restricted permissions (0700). An `EXIT` trap guarantees that staging directories are cleaned up automatically.
- **Exclusive Stash Ownership**: Setup creates a unique test stash directory using `mktemp -d "${TMP_TESTS_BASE}/tests_stash_XXXXXX"`. It never reuses or overwrites pre-existing PID-based directories.
- **Canonical Stash Path Validation**: `validate_stash_path()` enforces strict physical canonical path containment checks (`pwd -P`) within `${RUNNER_TEMP:-/tmp}`, rejects symbolic links (`[ -L "$p" ]`), and requires `tests_stash_*` naming conventions, preventing path traversal, symlink escapes, or deletion of out-of-bounds directories.
- **Atomic Manifest Pre-Validation**: `cleanup` pre-validates `installed_fixture_files` and `backed_up_files` atomically before executing any `rm` or `mv` operations. `orig_item` is strictly checked against the `ROOT_ITEMS` allowlist, `bak_item` must match `${orig_item}.test_bak_[0-9]+$`, duplicate mappings are rejected, and nested path components are forbidden. If any mapping in a manifest fails pre-validation, restoration is aborted entirely and setup/cleanup fails closed.
- **Workspace Recovery Guarantees**: Matrix setups tracked in `.test_workspace_state/` snapshot pre-existing workspace items before installation. If validation or restoration fails, state and backup files are preserved for manual recovery.
