# Repository Maintenance & Health

This document outlines the maintenance policies, repository invariants, sources of truth, build pipelines, verification commands, and pre-merge procedures for `@area44/workflows`.

## Repository Invariants

The `@area44/workflows` repository enforces machine-verifiable operational invariants:

- **Single Source of Truth**: Metadata, compatibility models, API contracts, and version declarations originate from single designated canonical source files.
- **Explicit API Contracts**: Public GitHub Actions APIs are defined explicitly in per-action `action.yml` files and validated programmatically.
- **Reproducible Artifacts**: Code in `dist/` is generated deterministically from `src/` via `npm run build` and verified for zero drift.
- **Machine-Verifiable Compatibility**: Compatibility between runtimes and package managers is governed by a canonical compatibility matrix and verified across CI matrix runs and test fixtures.
- **Strict Guardrails**: Public API contracts and upgrade rules prevent unintentional breaking changes across releases.

## Sources of Truth

To avoid duplication and configuration drift, specific files serve as authoritative sources of truth:

| Domain              | Authoritative Source of Truth File                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Package Versioning  | `package.json` (`version` property)                                                                               |
| Public Action APIs  | Per-action `action.yml` (`astro/action.yml`, `vite/action.yml`, `vite-plus/action.yml`, `lint-format/action.yml`) |
| Compatibility Model | `src/compatibility.ts` (`CANONICAL_COMPATIBILITY_MODEL`)                                                          |
| Build Pack Entries  | `vite.config.ts` (`pack` configuration array)                                                                     |
| Action List         | `src/action-contract.ts` (`PUBLIC_ACTIONS` array)                                                                 |

## Public Action Structure

Every public action provided by this repository must adhere to the following structure:

- A dedicated directory at the repository root matching its declared action name (e.g., `astro/`, `vite/`, `vite-plus/`, `lint-format/`).
- An `action.yml` metadata file defining inputs, outputs, and composite execution steps.
- A `README.md` file documenting exact input parameters, output parameters, and usage examples.
- Execution steps in `action.yml` that invoke verified build artifacts located in `dist/` (e.g., `dist/resolve-environment.mjs`).
- No unexpected top-level action directories containing `action.yml` without explicit registration in `PUBLIC_ACTIONS`.

## Build Artifacts Pipeline

The build artifact pipeline converts TypeScript sources into bundled, executable JavaScript artifacts in `dist/`:

```
src/
  ↓ (npm run build / vp pack)
dist/
  ↓ (npm run verify:artifacts)
Artifact Integrity Verification
```

### Generated Files

The following generated files are produced from source code and checked into git:

- `dist/resolve-environment.mjs` (generated from `src/resolve-environment.ts` and imports)
- `dist/lint-format.mjs` (generated from `src/lint-format.ts`)
- `dist/site-variables.mjs` (generated from `src/site-variables.ts`)
- `dist/build-command.mjs` (generated from `src/build-command.ts`)

Build artifacts must never be edited directly. Modifications must be made in `src/`, followed by re-running `npm run build` to update `dist/`.

## Verification Commands

Maintainers and automated CI pipelines run the following verification commands:

| Command                    | Description                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm test`                 | Runs all Vitest/Vite+ unit test suites                                                           |
| `npm run lint`             | Runs code linting rules via Vite+                                                                |
| `npm run format`           | Verifies code formatting via Vite+                                                               |
| `npm run build`            | Bundles TypeScript source files in `src/` to `dist/`                                             |
| `npm run verify:artifacts` | Verifies expected `dist/` build artifacts exist, are non-empty, and match git state              |
| `npm run verify:version`   | Verifies `package.json` version format and `package-lock.json` synchronization                   |
| `npm run verify:upgrade`   | Evaluates upgrade guardrails against baseline revision to prevent breaking contract changes      |
| `npm run verify:docs`      | Verifies semantic consistency between action contracts, compatibility matrix, and documentation  |
| `npm run verify:health`    | Runs comprehensive repository health verification across structures, contracts, fixtures, and CI |

## Pre-Merge & Pre-Release Checklist

Before merging pull requests or cutting a new release, maintainers must complete the following steps:

- Ensure all source changes are compiled to `dist/` by executing `npm run build`.
- Verify code formatting and linting pass with `npm run format` and `npm run lint`.
- Execute the full verification suite locally:
  - `npm test`
  - `npm run verify:artifacts`
  - `npm run verify:version`
  - `npm run verify:upgrade`
  - `npm run verify:docs`
  - `npm run verify:health`
- Check git status using `git status --short` and `git diff --check` to ensure no untracked files or whitespace errors exist.

## Change Classification Guidelines

When making modifications, maintainers must update corresponding configuration, documentation, or version numbers based on the change type:

| Change Type                              | Required Action / Updates                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Bug Fix / Internal Refactoring**       | Patch version bump in `package.json` and `package-lock.json`. Re-run `npm run build`.                                                |
| **New Action Input / Output (Optional)** | Minor version bump in `package.json`. Update action's `action.yml`, `README.md`, and root `README.md`.                               |
| **Compatibility Matrix Expansion**       | Minor version bump in `package.json`. Update `src/compatibility.ts`, `COMPATIBILITY.md`, `docs/compatibility.md`, and test fixtures. |
| **Breaking Action API Change**           | Major version bump in `package.json`. Update `action.yml`, `README.md`, `COMPATIBILITY.md`, and upgrade guardrails documentation.    |
| **Documentation / Comments**             | Patch version bump or no version change if purely documentation. Verify with `npm run verify:docs`.                                  |
