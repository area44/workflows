# Consumer Integration Testing & Scenario Factory Guide

This document explains the purpose, architecture, scenario definitions, isolated workspace layout, and execution of integration testing for `area44/workflows` using dynamically generated consumer project scenarios.

## Overview & Scenario Factory Architecture

To ensure that composite actions (`pages` and `autofix`) function correctly across diverse project configurations—beyond unit tests—`area44/workflows` uses a unified scenario factory to dynamically generate consumer projects:

- **Canonical Generator Script (`.github/scripts/generate-consumer-project.js`)**: Single authoritative source of truth for project file contents, scenario templates, CLI argument parsing, non-empty checks, and overwrite protections. Requires an explicit target directory argument (`generate-consumer-project.js <target-directory> [options]`).
- **TypeScript Test Helper (`__tests__/helpers/consumer-project.ts`)**: Re-exports `createConsumerProject` and `generateConsumerProjectFiles` directly from the canonical generator module so unit/integration tests share identical generation logic without drift.

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

## Retained Integration Scenarios

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

- **Execution Boundary**: Runs in Vitest (`vite-plus/test`) importing source modules directly from `src/`.
- **Purpose**: Fast local execution validating environment detection, output formatting, site variable calculations, custom command parsing, and error diagnostics against generated scenarios in temporary directories (`os.tmpdir()`).

### 2. Action-Level Composite CI Matrix (`.github/workflows/test-actions.yml`)

- **Execution Boundary**: Runs local composite actions (`./action-source/pages` and `./action-source/autofix`) in GitHub Actions runners.
- **Isolated Workspace Layout**:
  - The action repository is checked out into a dedicated subdirectory `action-source/`.
  - The target consumer project is generated in `$GITHUB_WORKSPACE` (the root CWD), outside `action-source/`.
  - The local action is invoked via `uses: ./action-source/pages` or `uses: ./action-source/autofix`.
  - The action source checkout in `action-source/` is never modified or mutated by fixture generation or action execution.
- **Purpose**: End-to-end execution of the composite action pipeline:
  - **Action Invocation**: Invokes `./action-source/pages` or `./action-source/autofix` against the generated project.
  - **Output & Artifact Verification**: Asserts step outputs and checks produced artifacts (e.g., `dist/index.html`).
  - **Negative Failure Mode Testing**: Verifies that invalid build commands or missing output directories trigger explicit step failures with expected error messages.

---

## Running Integration Tests Locally

```bash
# Run full test suite
npm test

# Run generator scenario tests
npm test __tests__/generate-consumer-project.test.ts

# Run consumer integration module tests
npm test __tests__/integration-consumer.test.ts
```
