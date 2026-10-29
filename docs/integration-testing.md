# Integration Testing & Scenario Factory Guide

This document defines the integration testing architecture, scenario factory design, isolated workspace layout, local test execution, and GitHub Actions CI matrix verification across `@area44/workflows`.

## Purpose and Scope

This guide details how `@area44/workflows` verifies composite action behavior (`pages` and `autofix`) and environment resolution logic against realistic consumer projects without maintaining fragile static fixture directories.

## Overview & Scenario Factory Architecture

To ensure action workflows function reliably across diverse project configurations, the repository uses a unified scenario factory to dynamically generate consumer projects:

- **Canonical Generator Script (`.github/scripts/generate-consumer-project.js`)**: The single authoritative source of truth for project file templates, package manifests, lockfiles, CLI argument parsing, directory checks, and overwrite protections. Requires an explicit target directory argument (`node .github/scripts/generate-consumer-project.js <target-directory> [options]`).
- **TypeScript Test Helper (`__tests__/helpers/consumer-project.ts`)**: Re-exports `createConsumerProject` and `generateConsumerProjectFiles` directly from the canonical generator module so unit and module-level integration tests share identical generation logic.

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
| **Marker Content**  | `markerContent`        | Assertion string included in HTML outputs (e.g. `"AREA44 Workflows Consumer Project"`)                                                                |

### Target Directory Safety & Overwrite Protection

To prevent accidental data loss during local testing or CI runs:

- **Explicit Target Required**: The CLI and helper functions refuse to run without an explicit target directory path.
- **`allowNonEmpty` Option (`--allow-non-empty`)**: Permits generation into a non-empty directory if pre-existing files do not collide with generated files.
- **`overwrite` Option (`--overwrite`)**: Explicitly permits overwriting pre-existing files whose names collide with generated outputs (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `bun.lock`, `pyproject.toml`, `requirements.txt`, `index.html`, `main.py`).

---

## Testing Boundaries & Execution

Testing is organized across distinct execution boundaries:

### 1. Unit & Module-Level Tests (`npm test`)

- **Execution Boundary**: Runs via Vite+ (`vp test` / Vitest) directly importing source modules from `src/`.
- **Unit Tests**: Modules under `__tests__/` test individual domain logic (`python-env.test.ts`, `javascript-env.test.ts`, `resolve-environment.test.ts`, `build-command.test.ts`, `site-variables.test.ts`, `autofix.test.ts`, `generate-consumer-project.test.ts`).
- **Module-Level Integration Tests (`__tests__/integration-consumer.test.ts`)**: Fast local tests validating environment detection, output formatting, site variable calculations, custom build command parsing, and error diagnostics against generated scenarios in temporary directories (`os.tmpdir()`).

### 2. Action-Level Composite CI Matrix (`.github/workflows/test-actions.yml`)

- **Execution Boundary**: Runs live composite actions (`./action-source/pages` and `./action-source/autofix`) in GitHub Actions runners.
- **Isolated Workspace Layout**:
  - The action repository source is checked out into a dedicated subdirectory `action-source/`.
  - The target consumer project is generated at the runner workspace root `$GITHUB_WORKSPACE`, outside `action-source/`.
  - Local composite actions are invoked via `uses: ./action-source/pages` or `uses: ./action-source/autofix`.
  - The action source directory `action-source/` remains pristine and unmutated throughout testing.
- **Positive Scenarios**:
  - Astro, Vite, and Vite+ site compilation and Pages artifact generation.
  - Node.js and Bun runtime setup and dependency synchronization (`npm`, `pnpm`, `bun`).
  - Python `uv` and `pip` environment detection, Ruff linting/formatting, and multi-language projects (`mixed`, `mixed-bun`).
- **Negative Scenarios & Machine-Verifiable Failure Logging**:
  - **Expected Failure Subshell Harness**: Expected-failure negative scenarios execute step scripts (`dist/build-command.mjs`) inside a subshell harness capturing stdout/stderr to prevent unhandled `::error::` workflow command annotations on GitHub Actions run summaries.
  - **Pre-Execution Cleanup**: Step `Clean Build Outputs Before Execution` removes pre-existing build output directories (`rm -rf "$TARGET_PATH" dist`) and clears `${RUNNER_TEMP}/pages_build_error.log` before action execution.
  - **Invalid Build Command (`invalid_build_command`)**: Harness asserts exit code 1 and verifies `${RUNNER_TEMP}/pages_build_error.log` contains `"Build command execution failed with exit code"`.
  - **Missing Output Directory (`missing_output_dir`)**: Harness asserts exit code 1 and verifies `${RUNNER_TEMP}/pages_build_error.log` contains `"Build output validation failed: Configured build output directory '${BUILD_PATH}' does not exist."`.

### 3. CI Quality & Dist Consistency Workflows (`.github/workflows/ci.yml`)

- **`quality-test` Job**: Provisions Node 24 and Bun 1.4 baseline, runs `npm ci`, code linting (`npm run lint`), formatting check (`npm run format --check`), and unit tests (`npm test`).
- **`check-dist` Job**: Provisions Node 24, runs `npm ci`, builds artifacts (`npm run build`), and checks for any git diff or untracked files under `dist/` (`git status --porcelain dist/`).

---

## How to Add a New Test Scenario

1. Pass required scenario options to `generateConsumerProjectFiles(options)` or `createConsumerProject(targetDir, options)`.
2. If new file templates or option dimensions are needed, update `.github/scripts/generate-consumer-project.js`.
3. Add unit test assertions in `__tests__/generate-consumer-project.test.ts`.
4. Add module-level integration assertions in `__tests__/integration-consumer.test.ts` or add matrix entries to `.github/workflows/test-actions.yml`.

---

## Local Test Execution Commands

```bash
# Run full unit and module integration test suite
npm test

# Run scenario factory generator unit tests
npm test __tests__/generate-consumer-project.test.ts

# Run consumer integration module tests
npm test __tests__/integration-consumer.test.ts

# Run code style linting
npm run lint

# Check code formatting
npm run format --check

# Build bundled artifacts in dist/
npm run build
```

---

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Error Handling Architecture](./errors.md)**: Native JavaScript error boundaries and failure logging.
- **[Security Boundaries](./security.md)**: Trust boundaries, process tokenization, and secret masking.
- **[Maintenance & Repository Health](./maintenance.md)**: Source files, build pipeline, and quality gates.
