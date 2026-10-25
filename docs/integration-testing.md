# Consumer Integration Testing Guide

This document explains the purpose, architecture, execution, and extension of end-to-end integration testing for `area44/workflows` using the temporary consumer project fixture.

## Overview & Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly when consumed by real projects—beyond isolated unit tests—`area44/workflows` maintains an isolated, lightweight consumer fixture at:

`tests/integration/fixtures/consumer-project/`

### Fixture Structure

- **`package.json`**: Defines standard Node.js package metadata, scripts (`build`, `lint`, `format`), and package manager declaration (`npm@10.8.2`).
- **`package-lock.json`**: Lockfile for reproducible npm installation.
- **`index.html`**: HTML static asset entrypoint for build verification.
- **`pyproject.toml`**: Python project configuration with `ruff` dependency specification.
- **`requirements.txt`**: Pinned Python dependency manifest (`ruff==0.17.2`).
- **`main.py`**: Python source code file to exercise Python linting and formatting workflows.

The fixture represents a real-world multi-language (JS + Python) consumer application.

---

## Running Integration Tests Locally

Integration tests run using Vitest (`vp test`) and execute inside isolated temporary directories to prevent mutating the repository state.

### Run All Tests

```bash
npm test
```

### Run Consumer Integration Suite Only

```bash
npm test __tests__/integration-consumer.test.ts
```

---

## Running Integration Tests in CI

In GitHub Actions, integration tests run as part of the action verification matrix in `.github/workflows/test-actions.yml`.

### Matrix Integration Mechanics

1. **Workspace Setup**: `.github/scripts/test-workspace-cleanup.sh setup` copies `tests/integration/fixtures/consumer-project` into the workspace root while stashing existing repository test directories.
2. **Action Execution**: The workflow invokes `./pages` or `./autofix` using local relative paths.
3. **Output & Artifact Verification**: Outputs (`package-manager`, `runtime`, `toolchain`, `has-js-project`, `has-python-source`, etc.) and generated build artifacts (`dist/index.html`) are validated.
4. **Workspace Cleanup**: `.github/scripts/test-workspace-cleanup.sh cleanup` restores original workspace files and stashed directories.

---

## Targeting the Branch Under Test

To ensure changes under review are tested before merging:

- Integration tests reference local action definitions (`./pages` and `./autofix`) rather than remote refs (`area44/workflows/pages@main`).
- Unit and integration test suites in `__tests__/` import directly from source modules in `src/`.

---

## Adding a New Integration Scenario

1. **Add Fixture Assets or Scenarios**:
   - For JavaScript/Python consumer scenarios, add or update files in `tests/integration/fixtures/consumer-project/`.
   - For distinct environment matrices, add a subfolder under `tests/integration/fixtures/`.

2. **Add Unit/Integration Assertions**:
   - Add test cases in `__tests__/integration-consumer.test.ts` exercising environment resolution, variable resolution, or build/autofix execution.

3. **Add CI Matrix Case**:
   - Add a matrix entry under `include:` in `.github/workflows/test-actions.yml` pointing to your fixture path.

---

## GitHub-Hosted Runner Requirements & Limitations

Some integration steps require a real GitHub Actions runner environment:

- **Pages Artifact Upload (`actions/upload-pages-artifact`)**: Requires GitHub Pages permissions and GitHub runner environment tokens.
- **Autofix CI Push (`autofix-ci/action`)**: Requires `github.workflow == 'autofix.ci'` and `contents: write` permissions.

These GitHub-hosted steps are executed and verified during CI workflow runs on GitHub Actions runners.

---

## Cleanup & Safety Guarantees

All workspace state mutations during matrix setup are tracked in `.test_workspace_state/`:

- Pre-existing files are safely backed up before fixture installation.
- Installed files and generated build/cache artifacts are tracked in manifests.
- Restoration verifies manifest integrity before deleting or moving files.
