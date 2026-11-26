# ADR 0004: Runtime Precedence Order

**Status**: Accepted
**Date**: 2024-01-15

## Context

Multiple signals can indicate the JavaScript runtime (Node.js vs Bun). We need a deterministic, documented precedence order that only applies when signals are **consistent** (ADR 0003: contradictory signals fail).

Signals considered:

1. `devEngines` in `package.json` (explicit runtime declaration)
2. Version files: `.bun-version` vs `.nvmrc` / `.node-version`
3. Package manager: `bun` package manager implies Bun runtime
4. Default: Node.js

## Decision

**Precedence order (highest to lowest):**

1. **`devEngines` runtime** — Explicit author intent in `package.json`
2. **Version files** — `.bun-version` (Bun) or `.nvmrc`/`.node-version` (Node.js)
3. **Package manager** — `bun` package manager → Bun runtime; `npm`/`pnpm` → Node.js
4. **Default** — Node.js

**Validation**: If multiple signals exist at the **same precedence level** and contradict (e.g., both `.bun-version` and `.nvmrc`), validation fails (ADR 0003).

## Consequences

### Positive

- **Author intent wins**: `devEngines` is the most explicit, intentional signal
- **Version files as fallback**: Common in monorepos/teams standardizing on a runtime
- **Package manager as weak signal**: Useful for `bun` (which bundles runtime + pm); `npm`/`pnpm` don't imply runtime
- **Predictable default**: Node.js is the ecosystem default; safe fallback

### Negative

- **`devEngines` obscurity**: Many developers don't know `package.json#devEngines` exists; may accidentally set it
- **Version file confusion**: `.nvmrc` is for nvm (Node version manager), not a runtime selector per se

### Neutral

- **`packageManager` field** (npm v9+): Treated as package manager signal, not runtime signal directly. But `packageManager: "bun@1.2.3"` implies Bun runtime.

## Alternatives Rejected

- **Package manager first**: `bun` pm → Bun runtime; but `npm`/`pnpm` don't imply Node.js (could be Bun runtime with npm pm — valid but unusual)
- **Version files first**: `.nvmrc` is often committed by developers using nvm locally, not as a project policy
- **No precedence (all must agree)**: Too strict; would fail valid configs where only one signal is present

## Related

- ADR 0003: Validation fails on contradictory configuration
- `src/javascript-env/runtime-resolver.ts` — `resolveRuntime` and `validateRuntimeConflicts`
- `docs/environment-resolution.md` — Runtime precedence rules
