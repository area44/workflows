# Artifact Integrity Contract

This document defines the build policy, generated artifact structure, release integrity workflow, and verification rules for `@area44/workflows`.

## Single Source of Truth

- **Source Directory (`src/`)**: All implementation logic resides exclusively in TypeScript files under `src/`.
- **Generated Directory (`dist/`)**: The `dist/` directory is a mandatory, git-tracked generated build target containing bundled ES modules (`.mjs`). No production logic may exist in `dist/` without corresponding source code in `src/`.
- **Manual Edit Prohibition**: Direct edits to `dist/` files are strictly prohibited. Any modification to `dist/` must be the deterministic result of running the official build command from source.

## Official Build Pipeline

- **Build Command**: `npm run build` (invokes `vp pack`).
- **Entry Configuration**: Configured in `vite.config.ts`, mapping entrypoints:
  - `src/resolve-environment.ts` → `dist/resolve-environment.mjs`
  - `src/lint-format.ts` → `dist/lint-format.mjs`
  - `src/site-variables.ts` → `dist/site-variables.mjs`
  - `src/build-command.ts` → `dist/build-command.mjs`
- **Consumer Action Entry Points**: Public composite actions (`astro`, `vite`, `vite-plus`, `lint-format`) execute generated entrypoints via `$ACTION_PATH/../dist/<entrypoint>.mjs`.

## Verification Engine & Integrity Rules

Generated artifact verification is powered by `src/artifact-integrity.ts` (`verifyArtifactIntegrity()` and `runArtifactVerification()`):

- **Expected Artifact Integrity**: Verifies that all expected entrypoint `.mjs` files defined in `vite.config.ts` exist and are non-empty.
- **Extra File Detection**: Flags unexpected extra or untracked files inside `dist/`.
- **Source-to-Dist Synchronization**: Rebuilds artifacts from current source code and runs `git status --porcelain -- dist/` to confirm that committed `dist/` files are perfectly synchronized with `src/`.

## Machine Verification

Artifact integrity is enforced locally and in CI via:

```bash
npm run verify:artifacts
```
