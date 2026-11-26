# ADR 0002: Committed `dist/` with Build-Time Bundling

**Status**: Accepted
**Date**: 2024-01-15

## Context

Composite actions invoke Node entrypoints. Options for producing `dist/`:

1. **Commit `dist/`** (current): `npm run build` (`vp pack`) bundles `src/` → `dist/`; commit both; CI verifies with `check-dist`
2. **Generate in CI**: Build `dist/` during action execution (e.g., `postinstall` or action step)
3. **Publish to npm**: Build and publish `@area44/workflows` package; actions fetch from registry

## Decision

**Commit `dist/`** to the repository. `npm run build` is a mandatory step after any `src/` change. CI fails (`check-dist` job) if `dist/` diverges from `src/`.

## Consequences

### Positive

- **Zero-runtime build**: Action runs immediately — no `npm install`, no compilation, no network fetch
- **Deterministic execution**: The exact code reviewed is the code executed; no supply-chain gap between source and runtime
- **Auditability**: Consumers can `git show area44/workflows@main:dist/autofix.mjs` to verify what runs
- **No registry dependency**: Works offline; no npm rate limits, no publishing pipeline
- **Simple mental model**: `src/` → build → `dist/` → commit → release; same as any compiled language

### Negative

- **Developer friction**: Must remember `npm run build` + commit `dist/` after every `src/` change
- **Repo size**: `dist/` adds ~200KB of bundled JS (acceptable for this scale)
- **Merge conflicts**: `dist/` changes can conflict in PRs (mitigated: `check-dist` fails PRs that forget to rebuild)

### Neutral

- **`vp pack`**: Uses Vite+ bundler (same toolchain as consumer projects); outputs ESM `.mjs` files
- **`check-dist`**: Runs `npm run build` then `git status --porcelain dist/` — fails if non-empty

## Alternatives Rejected

- **Generate in CI**: Adds 10-30s to every action run; non-deterministic if build tools drift; defeats "zero-runtime" benefit
- **Publish to npm**: Adds publishing pipeline, version coordination, registry dependency; overkill for internal ecosystem actions

## Related

- ADR 0001: Composite actions over reusable workflows
- `docs/maintenance.md` — Build pipeline and quality gates
