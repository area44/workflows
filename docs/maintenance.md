# Repository Maintenance & Health

This document outlines the maintenance policies, repository invariants, sources of truth, build pipelines, and release procedures for `@area44/workflows`.

## Repository Invariants

The `@area44/workflows` repository enforces machine-verifiable operational invariants:

- **Single Source of Truth**: Metadata, API contracts, and version declarations originate from single designated canonical source files.
- **Explicit API Contracts**: Public GitHub Actions APIs are defined explicitly in per-action `action.yml` files.
- **Action Bootstrap Runtime**: Internal action entrypoints (`dist/*.mjs`) run consistently under Node.js across supported GitHub Actions runners. The target project runtime (`RUNTIME`) and package manager (`PACKAGE_MANAGER`) determine how user project commands (`bun install`, `pnpm install`, `npm run build`, `vp build`, `ruff`) are executed, keeping internal action orchestration decoupled from project runtime selection.
- **Reproducible Artifacts**: Code in `dist/` is generated deterministically from `src/` via `npm run build` and verified for zero drift.

## Sources of Truth

To avoid duplication and configuration drift, specific files serve as authoritative sources of truth:

| Domain             | Authoritative Source of Truth File                                 |
| ------------------ | ------------------------------------------------------------------ |
| Package Versioning | `package.json` (`version` property)                                |
| Public Action APIs | Per-action `action.yml` (`pages/action.yml`, `autofix/action.yml`) |
| Build Pack Entries | `vite.config.ts` (`pack` configuration array)                      |

## Public Action Structure

Every public action provided by this repository must adhere to the following structure:

- A dedicated directory at the repository root matching its declared action name (e.g., `pages/`, `autofix/`).
- An `action.yml` metadata file defining inputs, outputs, and composite execution steps.
- A `README.md` file documenting exact input parameters, output parameters, and usage examples.
- Execution steps in `action.yml` that invoke verified build artifacts located in `dist/` using Node (e.g., `node "$ACTION_PATH/../dist/resolve-environment.mjs"`).

## Build Artifacts Pipeline

The build artifact pipeline converts TypeScript sources into bundled, executable JavaScript artifacts in `dist/`:

```
src/
  ↓ (npm run build / vp pack)
dist/
```

### Generated Files

The following generated files are produced from source code and checked into git:

- `dist/resolve-environment.mjs` (generated from `src/resolve-environment.ts` and imports)
- `dist/autofix.mjs` (generated from `src/autofix/index.ts`)
- `dist/site-variables.mjs` (generated from `src/pages/site-variables.ts`)
- `dist/build-command.mjs` (generated from `src/pages/build-command.ts`)

Build artifacts must never be edited directly. Modifications must be made in `src/`, followed by re-running `npm run build` to update `dist/`.

## Quality Gates and Test Commands

Maintainers and automated CI pipelines run the following verification and test commands:

| Command             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `npm test`          | Runs all Vitest/Vite+ unit test suites               |
| `npm run lint`      | Runs code linting rules via Vite+                    |
| `npm run format`    | Verifies code formatting via Vite+                   |
| `npm run build`     | Bundles TypeScript source files in `src/` to `dist/` |
| `npm run changeset` | Interactively creates a new changeset file           |

## Release Process and Versioning

This repository uses `@changesets/cli` to automate package versioning, changelog generation, and tag creation for the private `@area44/workflows` repository and its composite actions:

1. **Creating Changesets**: Every PR making code changes must include a changeset file (`.changeset/*.md`) added via `npx changeset`.
2. **Version PR**: When PRs are merged into `main`, GitHub Actions triggers Changesets to automatically open or update a Version PR.
3. **Tagging and Release**: Merging the Version PR executes `changeset git-tag`, creating release git tags (e.g. `v8.0.1`) and GitHub Releases. No publication to npm occurs as the workspace is private.
