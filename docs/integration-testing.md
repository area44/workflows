# Consumer Integration Testing Guide

This document explains the purpose, architecture, boundaries, execution, and fixture consolidation policy of integration testing for `area44/workflows` using dynamically generated consumer project fixtures.

## Overview & Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly when consumed by real projects—beyond isolated unit tests—`area44/workflows` generates consumer projects dynamically in temporary directories using a single canonical generator module:

- **Canonical Generator Script (`.github/scripts/generate-consumer-project.js`)**: Single source of truth defining file contents, templates, and safety checks.
- **TypeScript Test Helper (`__tests__/helpers/consumer-project.ts`)**: Re-exports `createConsumerProject` and `generateConsumerProjectFiles` directly from the canonical JS generator module so unit tests and Node scripts share identical generation logic without drift.

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
  - **Workspace Installation**: `.github/scripts/test-workspace-cleanup.sh setup` generates a dynamic consumer project into an isolated temporary staging directory created safely via `mktemp -d` while stashing `__tests__` (preventing test files from polluting matrix runs).
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

## Temporary Directory Ownership & Workspace Safety Guarantees

All temporary consumer projects created during unit/integration tests and CI matrix runs enforce strict ownership and deterministic cleanup:

- **Exclusive Directory Ownership**: `.github/scripts/test-workspace-cleanup.sh` uses `mktemp -d "${TMP_FIX_BASE}/fixture_copy_XXXXXX"` to create unique staging directories with restricted permissions (0700). It never reuses existing directory paths based on PID.
- **Automatic Staging Cleanup**: A shell `trap` guarantees that temporary staging directories created during setup are removed upon exit, even if project generation or workspace setup fails prematurely.
- **Workspace State Protection**: Matrix setups tracked in `.test_workspace_state/` snapshot pre-existing workspace items before installation. Cleanup validates manifest paths and stash boundaries before removing generated artifacts or restoring pre-existing files.
