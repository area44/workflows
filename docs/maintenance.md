# Maintenance

Sources of truth, build pipeline, quality gates, and release process for this repository.

## Sources of truth

| Domain               | Authoritative source                             |
| -------------------- | ------------------------------------------------ |
| Package version      | `package.json` `version`                         |
| Public action APIs   | `pages/action.yml`, `autofix/action.yml`         |
| Build entrypoints    | `vite.config.ts` `pack` array (`src/` → `dist/`) |
| Environment behavior | `src/resolve-environment.ts` + `tests/`          |

Metadata, API contracts, and version declarations each have exactly one authoritative source; other files reference rather than duplicate them.

## Structure

Each action is a root directory with an `action.yml` (inputs, outputs, step guards, steps) and a consumer `README.md`. Execution steps invoke committed artifacts in `dist/` via Node, e.g. `node "$ACTION_PATH/../dist/resolve-environment.mjs"`. The bundled entrypoints under `dist/*.mjs` run under Node.js across supported runners; the target project's runtime (`RUNTIME`) and package manager (`PACKAGE_MANAGER`) only govern how project commands (`npm run build`, `bun install`, `ruff`) execute.

## Build pipeline

`npm run build` (`vp pack`) bundles `src/` into ESM entrypoints in `dist/`:

- `src/resolve-environment.ts` → `dist/resolve-environment.mjs`
- `src/autofix/index.ts` → `dist/autofix.mjs`
- `src/pages/site-variables.ts` → `dist/pages/site-variables.mjs`
- `src/pages/build-command.ts` → `dist/pages/build-command.mjs`

`dist/` is committed and must match `src/`. The `check-dist` job in `.github/workflows/ci.yml` runs `npm run build` and fails if `git status --porcelain dist/` is non-empty.

## Quality gates

| Gate               | Command / step                       |
| ------------------ | ------------------------------------ |
| Install            | `npm ci`                             |
| Lint + typecheck   | `npm run lint` (`vp lint`)           |
| Format check       | `npm run format --check`          |
| Build              | `npm run build` (`vp pack`)          |
| Unit + integration | `npm test` (`vp test`)               |
| Action CI matrix   | `.github/workflows/test-actions.yml` |

`quality-test` (lint, format, test) and `check-dist` run in parallel on every push to `main` and pull request.

## Release

Uses `@changesets/cli`. The package is `"private": true`, so it is tagged and released on GitHub but never published to npm (the field does not affect repo visibility).

1. PRs with user-facing changes include a changeset (`npm run changeset` → `.changeset/*.md`).
2. Merging to `main` makes Changesets open/update a Version PR that bumps `package.json` and `CHANGELOG.md`.
3. Merging the Version PR runs `npm run version` + `npm run release`, creating git tags and GitHub Releases.
