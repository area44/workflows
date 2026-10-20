# Repository Maintenance & Health

This document outlines the maintenance policies, repository invariants, sources of truth, build pipelines, and release procedures for `@area44/workflows`.

## Repository Invariants

The `@area44/workflows` repository enforces machine-verifiable operational invariants:

- **Single Source of Truth**: Metadata, API contracts, and version declarations originate from single designated canonical source files.
- **Explicit API Contracts**: Public GitHub Actions APIs are defined explicitly in per-action `action.yml` files.
- **Action Bootstrap Runtime**: Internal action entrypoints (`dist/*.mjs`) run consistently under Node.js across supported GitHub Actions runners. The target project runtime (`RUNTIME`) and package manager (`PACKAGE_MANAGER`) determine how user project commands (`bun install`, `pnpm install`, `npm run build`, `vp build`, `ruff`) are executed, keeping internal action orchestration decoupled from project runtime selection.

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

The `npm run build` command bundles source files from `src/` to produce executable artifacts in `dist/` for development, testing, and release workflows.

## Quality Gates and Test Commands

Maintainers and automated CI pipelines enforce the following quality gates and test commands:

| Stage / Gate             | Command / Pipeline Step             | Description                                           |
| ------------------------ | ----------------------------------- | ----------------------------------------------------- |
| Dependency Installation  | `npm ci`                            | Installs exact workspace dependencies                 |
| Lint                     | `npm run lint`                      | Validates code style and lint rules via Vite+         |
| Formatting Validation    | `npm run format -- --check`         | Checks code formatting without mutating source files  |
| Build                    | `npm run build`                     | Bundles TypeScript source code into `dist/` artifacts |
| Unit Tests               | `npm test`                          | Executes unit test suites via Vite+                   |
| Action Integration Tests | GitHub Actions (`test-actions.yml`) | Tests `pages` and `autofix` actions using fixtures    |
| Changeset Creation       | `npm run changeset`                 | Interactively creates a new changeset file            |

## Release Process and Versioning

This repository uses `@changesets/cli` to automate package versioning, changelog generation, and tag creation for the private `@area44/workflows` repository and its composite actions:

1. **Creating Changesets**: Every PR making code changes must include a changeset file (`.changeset/*.md`) added via `npx changeset`.
2. **Version PR**: When PRs are merged into `main`, GitHub Actions triggers Changesets to automatically open or update a Version PR.
3. **Tagging and Release**: Merging the Version PR executes `changeset git-tag`, creating release git tags (e.g. `v8.0.1`) and GitHub Releases. No publication to npm occurs as the workspace is private.
