# Consumer Integration Testing Guide

This document explains the purpose, architecture, boundaries, execution, and extension of integration testing for `area44/workflows` using the temporary consumer project fixture.

## Overview & Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly when consumed by real projects—beyond isolated unit tests—`area44/workflows` maintains an isolated, lightweight consumer fixture at:

`__tests__/fixtures/consumer-project/`

### Fixture Structure

- **`package.json`**: Defines standard Node.js package metadata, scripts (`"build": "mkdir -p dist && cp index.html dist/index.html"`, `lint`, `format`), and package manager declaration (`npm@10.8.2`).
- **`package-lock.json`**: Lockfile for reproducible npm installation.
- **`index.html`**: HTML static asset source containing `"AREA44 Workflows Consumer Project"`.
- **`pyproject.toml`**: Python project configuration with `ruff` dependency specification.
- **`requirements.txt`**: Pinned Python dependency manifest (`ruff==0.17.2`).
- **`main.py`**: Python source code file to exercise Python linting and formatting workflows.

The fixture represents a real-world multi-language (JS + Python) consumer application.

---

## Testing Boundaries & Architecture

Integration validation is divided into two distinct levels to balance speed and execution fidelity:

### 1. Module-Level Integration Tests (`__tests__/integration-consumer.test.ts`)

- **Execution Boundary**: Directly imports TypeScript source modules (`src/resolve-environment.ts`, `src/pages/site-variables.ts`, `src/pages/build-command.ts`, `src/javascript-env.ts`) in Vitest via `vite-plus/test`.
- **Purpose**: Fast local execution validating environment detection, output formatting, site variable calculations, custom command parsing, and error diagnostics against temporary clones of `__tests__/fixtures/consumer-project/`.

### 2. Action-Level Composite CI Matrix (`.github/workflows/test-actions.yml`)

- **Execution Boundary**: Invokes the local composite actions (`./pages` and `./autofix`) in GitHub Actions runners.
- **Purpose**: End-to-end execution of the composite action pipeline:
  - **Workspace Installation**: `.github/scripts/test-workspace-cleanup.sh setup` copies `__tests__/fixtures/consumer-project` into the workspace root while stashing `__tests__` (preventing test files from polluting matrix runs).
  - **Action Invocation**: Runs `./pages` and `./autofix` using local checkout code.
  - **Output & Artifact Verification**: Validates step outputs (`package-manager`, `runtime`, `toolchain`, `has-js-project`, `has-python-source`, etc.) and asserts that the build copies the source file to `dist/index.html` containing the consumer fixture title (`"AREA44 Workflows Consumer Project"`).
  - **Workspace Restoration**: `.github/scripts/test-workspace-cleanup.sh cleanup` restores original workspace files and stashed directories safely.

---

## Running Integration Tests Locally

### Run Full Test Suite

```bash
npm test
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

## Targeting the Branch Under Test

To ensure changes under review in pull requests are tested before merging:

- Action-level CI tests reference local relative action definitions (`./pages` and `./autofix`) rather than remote refs (`area44/workflows/pages@main`).
- Unit and module integration test suites in `__tests__/` import directly from source modules in `src/`.

---

## GitHub-Hosted Runner Integration Constraints

Certain integration steps depend on GitHub-hosted runner infrastructure and permissions:

- **GitHub Pages Artifact Upload (`actions/upload-pages-artifact`)**: Requires GitHub Pages permissions and runner environment tokens (`id-token: write`).
- **Autofix CI Push (`autofix-ci/action`)**: Requires `github.workflow == 'autofix.ci'` and `contents: write` permissions.

These external steps are guarded by workflow conditions and run during GitHub Actions CI workflow execution.

---

## Workspace Safety & Cleanup Guarantees

All workspace state mutations during matrix setup are tracked in `.test_workspace_state/`:

- Pre-existing workspace items are safely backed up before fixture installation.
- Installed files and generated build/cache artifacts are tracked in manifests.
- Restoration validates path boundaries and manifest integrity before deleting or moving files.
