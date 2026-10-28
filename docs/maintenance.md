# Repository Maintenance & Health

This document defines the maintenance policies, repository operational invariants, sources of truth, build pipelines, quality gates, and release procedures for `@area44/workflows`.

## Purpose and Scope

This specification governs code maintenance, build artifact generation, quality gate enforcement, and release versioning procedures across the `@area44/workflows` repository.

## Repository Invariants

The `@area44/workflows` repository enforces machine-verifiable operational invariants:

- **Single Source of Truth**: Metadata, API contracts, and version declarations originate from single designated canonical source files.
- **Explicit API Contracts**: Public GitHub Actions APIs are defined explicitly in per-action `action.yml` files (`pages/action.yml` and `autofix/action.yml`).
- **Action Bootstrap Runtime**: Internal action entrypoints (`dist/*.mjs`) run consistently under Node.js across supported GitHub Actions runners. The target project runtime (`RUNTIME`) and package manager (`PACKAGE_MANAGER`) determine how user project commands (`bun install`, `pnpm install`, `npm run build`, `vp build`, `ruff`) are executed, keeping internal action orchestration decoupled from project runtime selection.
- **Artifact Synchronization**: Tracked executable artifacts in `dist/` must remain perfectly synchronized with source code in `src/`.

## Sources of Truth

To prevent duplication and configuration drift, specific files serve as authoritative sources of truth:

| Domain             | Authoritative Source of Truth File                                 | Description                                                         |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Package Versioning | `package.json` (`version` property)                                | Primary package metadata and release version number.                |
| Public Action APIs | Per-action `action.yml` (`pages/action.yml`, `autofix/action.yml`) | Single source of truth for public inputs, outputs, and step guards. |
| Build Pack Entries | `vite.config.ts` (`pack` configuration array)                      | Canonical entrypoints mapping `src/` modules to `dist/*.mjs`.       |

## Public Action Structure

Every public composite action provided by this repository adheres to the following structure:

- A dedicated directory at the repository root matching its declared action name (e.g., `pages/`, `autofix/`).
- An `action.yml` metadata file defining inputs, outputs, step guards, environment variables, and execution steps.
- A consumer-facing `README.md` file documenting purpose, features, exact inputs, outputs, usage examples, and failure behavior.
- Execution steps in `action.yml` that invoke verified build artifacts located in `dist/` using Node (e.g., `node "$ACTION_PATH/../dist/resolve-environment.mjs"`).

## Build Artifacts Pipeline

The `npm run build` command uses Vite+ (`vp pack`) to compile and bundle TypeScript source files from `src/` into standalone executable ESM entrypoints in `dist/`:

- `src/resolve-environment.ts` -> `dist/resolve-environment.mjs`
- `src/pages/site-variables.ts` -> `dist/site-variables.mjs`
- `src/pages/build-command.ts` -> `dist/build-command.mjs`
- `src/autofix/index.ts` -> `dist/autofix.mjs`

The `check-dist` job in `.github/workflows/ci.yml` validates that committed `dist/` artifacts match freshly built outputs, failing if any drift is detected.

## Quality Gates and Test Commands

Maintainers and automated CI pipelines enforce the following quality gates:

| Stage / Gate              | Command / Pipeline Step                               | Description                                                         |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Dependency Installation   | `npm ci`                                              | Installs exact locked workspace dependencies.                       |
| Lint                      | `npm run lint` (`vp lint`)                            | Validates code style and lint rules via Vite+.                      |
| Formatting Validation     | `npm run format --check` (`vp fmt --check`)           | Checks code formatting without mutating source files.               |
| Build                     | `npm run build` (`vp pack`)                           | Bundles TypeScript source code into `dist/` artifacts.              |
| Unit & Integration Tests  | `npm test` (`vp test`)                                | Executes unit and scenario factory test suites via Vitest.          |
| Action Integration Matrix | GitHub Actions (`.github/workflows/test-actions.yml`) | Tests `pages` and `autofix` composite actions in live runner steps. |
| Changeset Creation        | `npm run changeset`                                   | Interactively creates a new changeset file.                         |

## Release Process and Versioning

This repository uses `@changesets/cli` to automate package versioning, changelog updates, and tag creation for the private `@area44/workflows` workspace:

1. **Creating Changesets**: Pull requests introducing user-facing changes include a changeset file under `.changeset/*.md` created via `npm run changeset`.
2. **Version PR**: When PRs are merged into `main`, Changesets automation opens or updates a Version PR that bumps `package.json` version and updates `CHANGELOG.md`.
3. **Tagging and Release**: Merging the Version PR triggers `changeset tag`, creating git release tags (e.g. `v8.0.1`) and GitHub Releases. Because `@area44/workflows` is a private repository (`"private": true`), no package publication to npm registry takes place.

## Related Documentation

- **[Repository README](../README.md)**: Main project overview and action API summary.
- **[Error Handling Architecture](./errors.md)**: Native JavaScript error boundaries and failure logging.
- **[Security Boundaries](./security.md)**: Trust boundaries, process tokenization, and secret masking.
- **[Maintenance & Repository Health](./maintenance.md)**: Source files, build pipeline, and quality gates.
