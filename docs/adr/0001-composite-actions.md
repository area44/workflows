# ADR 0001: Composite Actions Over Reusable Workflows

**Status**: Accepted
**Date**: 2024-01-15

## Context

We need to publish reusable GitHub Actions for the AREA44 ecosystem (pages deployment, autofix). Options considered:

1. **Composite actions** (current): `action.yml` with steps invoking Node entrypoints in `dist/`
2. **Reusable workflows**: `.github/workflows/*.yml` called via `uses: ./.github/workflows/...`
3. **Separate repositories**: One repo per action (`area44/pages-action`, `area44/autofix-action`)
4. **Docker container actions**: Custom Docker images

## Decision

Use **composite actions** with bundled Node entrypoints in `dist/`.

## Consequences

### Positive

- **Single installation**: Consumers add one step (`uses: area44/workflows/pages@main`), no workflow file management
- **Version pinning**: Consumers pin to `@main`, `@v1`, or SHA — same as any action. `@main` is a floating reference (always latest `main`); `@v1` is a major-version tag; a commit SHA is an immutable reference. GitHub recommends commit SHA for highest stability and security.
- **Monorepo simplicity**: Shared code (`src/resolve-environment`, `src/javascript-env`, `src/python-env`) stays in one place
- **No Docker overhead**: Runs on standard `ubuntu-latest` runners; no image build/push/maintenance
- **Transparent debugging**: Entrypoints are readable `.mjs` files; consumers can inspect `dist/` before using

### Negative

- **Dist commitment**: Must run `npm run build` and commit `dist/` after every `src/` change (enforced by `check-dist` CI)
- **Node.js coupling**: Entrypoints require Node.js on the runner (always available on GitHub-hosted runners)
- **Action.yml verbosity**: Composite action steps are inline YAML; complex logic moves to entrypoints

### Neutral

- **Entrypoint pattern**: Each action has 1-4 entrypoints (`resolve-environment.mjs`, `autofix.mjs`, `site-variables.mjs`, `build-command.mjs`) invoked via `node "$ACTION_PATH/../dist/..."`

## Alternatives Rejected

- **Reusable workflows**: Require consumers to manage workflow files, harder to version, less discoverable in marketplace
- **Separate repos**: Duplicates shared environment resolution logic; fragments CI, releases, issue tracking
- **Docker actions**: Adds image build/publish pipeline; larger attack surface; slower cold starts

## Related

- ADR 0002: Committed `dist/` with build-time bundling
- ADR 0003: Pure setup plan derived from resolved environment
