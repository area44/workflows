# Consumer Integration Testing & Scenario Factory Guide

This document explains the purpose, architecture, scenario definitions, cleanup safety guarantees, and execution of integration testing for `area44/workflows` using dynamically generated consumer project scenarios.

## Overview & Scenario Factory Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly across diverse project configurations—beyond unit tests—`area44/workflows` uses a unified scenario factory to dynamically generate consumer projects in temporary directories:

- **Canonical Generator Script (`.github/scripts/generate-consumer-project.js`)**: Single authoritative source of truth for project file contents, scenario templates, CLI argument parsing, non-empty checks, and overwrite protections. Requires an explicit target directory argument (`generate-consumer-project.js <target-directory> [options]`).
- **TypeScript Test Helper (`__tests__/helpers/consumer-project.ts`)**: Re-exports `createConsumerProject` and `generateConsumerProjectFiles` directly from the canonical generator module so unit/integration tests and shell scripts share identical generation logic without drift.

### Scenario Dimensions & Factory Options

The scenario factory supports explicit options across all tested project dimensions:

| Dimension           | Factory Options        | Supported Values                                                                                                                                      |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**          | `action`               | `pages`, `autofix`, or empty/unspecified                                                                                                              |
| **Runtime**         | `runtime`              | `node`, `bun`                                                                                                                                         |
| **Package Manager** | `pm`, `packageManager` | `npm`, `pnpm`, `bun`, or explicit version string (e.g. `pnpm@12.15.0`)                                                                                |
| **Toolchain**       | `toolchain`            | `astro`, `vite`, `vite-plus`, `none`                                                                                                                  |
| **Project Type**    | `type`                 | `basic`, `minimal`, `vite`, `vite-plus`, `consumer-integration`, `python-uv`, `python-pip`, `python-conflicting`, `python-none`, `mixed`, `mixed-bun` |
| **Python Source**   | `hasPythonSource`      | `true`, `false` (controls `.py`/`.pyi` file generation)                                                                                               |
| **Python PM**       | `pythonPm`             | `uv`, `pip`, or empty                                                                                                                                 |
| **Ruff Version**    | `ruffVersion`          | Version string (e.g. `0.17.2`) or empty string `""`                                                                                                   |
| **Marker Content**  | `markerContent`        | Assertion string included in HTML outputs (e.g. `AREA44 Workflows Consumer Project`)                                                                  |

### Target Directory Safety & Overwrite Protection

To prevent accidental data loss during local development or test runs:

- **Explicit Target Required**: The CLI and helper function refuse to run without an explicit target directory path.
- **`allowNonEmpty` Option / `--allow-non-empty` Flag**: Permits generation into a non-empty directory if pre-existing files are unrelated (e.g., `pre_existing.txt`).
- **`overwrite` Option / `--overwrite` Flag**: Explicitly permits overwriting files whose names collide with generated outputs (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `bun.lock`, `pyproject.toml`, `requirements.txt`, `index.html`, `main.py`). Even when `allowNonEmpty` is true, colliding files will NOT be overwritten unless `overwrite` is set.

---

## Retained Integration Scenarios & Dynamic Migration

Static fixture files under `__tests__/fixtures/` have been consolidated into dynamic scenario definitions. The following distinct integration behaviors are covered:

1. **Astro Builds**: `action: "pages", toolchain: "astro"` generates `astro.config.mjs` and `src/pages/index.astro`.
2. **Vite Builds**: `type: "vite"` or `toolchain: "vite"` generates `vite.config.ts`, `index.html`, and `src/main.ts`.
3. **Vite+ Builds**: `type: "vite-plus"` or `toolchain: "vite-plus"` generates `vite.config.ts` and `index.html` configured for `vp build`.
4. **Package Manager & Runtime Resolution**: npm, pnpm, and Bun projects across Node.js and Bun runtimes.
5. **Python uv & pip Workflows**: `uv`-managed projects (`uv.lock`), `pip`-managed projects (`requirements.txt`), conflicting lockfiles, and `python-none` projects without Python source.
6. **Mixed Language Projects**: JavaScript + Python multi-language repositories.
7. **Consumer Integration**: End-to-end HTML artifact generation and marker content validation (`"AREA44 Workflows Consumer Project"`).

---

## How to Add a New Test Scenario

To add a new scenario:

1. Pass the relevant scenario options to `generateConsumerProjectFiles(options)` or `createConsumerProject(targetDir, options)`.
2. If new file templates or option dimensions are required, add them to `generateConsumerProjectFiles` in `.github/scripts/generate-consumer-project.js`.
3. Add unit test assertions for the new scenario options in `__tests__/generate-consumer-project.test.ts`.

---

## Testing Boundaries & Execution

Integration testing is performed across two distinct boundaries:

### 1. Module-Level Integration Tests (`__tests__/integration-consumer.test.ts`)

- **Execution Boundary**: Runs in Vitest (`vite-plus/test`) importing source modules (`src/resolve-environment.ts`, `src/pages/site-variables.ts`, `src/pages/build-command.ts`, `src/javascript-env.ts`).
- **Purpose**: Fast local execution validating environment detection, output formatting, site variable calculations, custom command parsing, and error diagnostics against generated scenarios in temporary directories (`os.tmpdir()`).

### 2. Action-Level Composite CI Matrix (`.github/workflows/test-actions.yml`)

- **Execution Boundary**: Runs local composite actions (`./pages` and `./autofix`) in GitHub Actions runners.
- **Purpose**: End-to-end execution of the composite action pipeline:
  - **Workspace Setup**: `.github/scripts/test-workspace-cleanup.sh setup "$ACTION" "$RUNTIME" "$PM" "$TYPE"` generates the requested scenario dynamically into a temporary staging directory created safely via `mktemp -d` while stashing `__tests__` into an exclusively owned `mktemp -d` stash directory.
  - **Action Invocation**: Invokes `./pages` or `./autofix` against the generated project.
  - **Output & Artifact Verification**: Asserts step outputs and checks produced artifacts (e.g., `dist/index.html`).
  - **Workspace Restoration**: `.github/scripts/test-workspace-cleanup.sh cleanup` restores original workspace files and stashed directories safely.

---

## Running Integration Tests Locally

```bash
# Run full test suite
npm test

# Run generator scenario tests
npm test __tests__/generate-consumer-project.test.ts

# Run consumer integration module tests
npm test __tests__/integration-consumer.test.ts

# Run workspace cleanup script validation
npm test __tests__/workspace-cleanup.test.ts
```

---

## Temporary Directory Ownership & Two-Phase Fail-Closed Cleanup Guarantees

All temporary consumer projects created during unit/integration tests and CI matrix runs enforce strict ownership, two-phase fail-closed validation, and deterministic cleanup:

- **Exclusive Staging Ownership**: `.github/scripts/test-workspace-cleanup.sh` uses `mktemp -d "${TMP_FIX_BASE}/fixture_copy_XXXXXX"` to create unique staging directories with restricted permissions. An `EXIT` trap guarantees that staging directories are cleaned up automatically on exit.
- **Exclusive Stash Ownership**: Setup creates a unique test stash directory using `mktemp -d "${TMP_TESTS_BASE}/tests_stash_XXXXXX"`. It never reuses or overwrites pre-existing PID-based directories.
- **Canonical Stash Path Validation**: `validate_stash_path()` enforces strict physical canonical path containment checks (`pwd -P`) within `${RUNNER_TEMP:-/tmp}`, rejects symbolic links (`[ -L "$p" ]`), and requires `tests_stash_*` naming conventions, preventing path traversal, symlink escapes, or deletion of out-of-bounds directories.
- **Two-Phase Fail-Closed Cleanup**:
  - **Phase 1 (Atomic Validation)**: Before any file is deleted or moved, all manifests (`installed_fixture_files`, `backed_up_files`, `snapshot.status`, `stash.info`) are parsed and validated in full. Installed fixtures are verified as top-level relative names, original backup items are checked against the `ROOT_ITEMS` allowlist, backup paths are matched against exact literal string patterns (`${orig_item}.test_bak_<digits>`), and duplicate/nested records are rejected.
  - **Phase 2 (Execution)**: Destructive file deletions and restorations occur ONLY if all Phase 1 validations pass with zero errors.
- **Workspace Recovery Guarantees**: Matrix setups tracked in `.test_workspace_state/` snapshot pre-existing workspace items before installation. If validation or restoration fails, state, backup files, and stashed directories are preserved for manual recovery.
