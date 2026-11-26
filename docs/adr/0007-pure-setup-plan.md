# ADR 0007: Pure Setup Plan Derived from Resolved Environment

**Status**: Accepted
**Date**: 2024-01-15

## Context

The `createSetupPlan` function transforms a `ResolvedEnvironment` into a `SetupPlan` (which `setup-*` actions to run, with what cache keys). Design options:

1. **Pure function** (current): `createSetupPlan(env: ResolvedEnvironment): SetupPlan` — no filesystem access, no side effects, no detection logic
2. **Impure function**: Reads filesystem, calls GitHub Actions APIs, duplicates detection logic
3. **Embedded in resolution**: `resolveEnvironment` returns both environment and plan together

## Decision

**Pure, deterministic function** — `createSetupPlan` takes a validated `ResolvedEnvironment` and returns a `SetupPlan`. It has:

- No filesystem access
- No GitHub Actions side effects (`core.setOutput`, `core.info`, etc.)
- No environment detection logic
- No duplication of logic owned by resolvers

## Consequences

### Positive

- **Testability**: Pure function → trivial unit tests with plain objects; no mocking, no fixtures
- **Consistency guarantee**: Plan is _derived_ from environment — impossible for plan to drift from environment
- **Single source of truth**: Environment resolution owns detection; setup plan owns GitHub Actions mapping
- **Composability**: Can be called from tests, other tools, or future actions without running full resolution
- **Auditability**: `dist/resolve-environment.mjs` exports `createSetupPlan`; consumers can verify the transform

### Negative

- **Two-step in action**: `resolveEnvironment()` → `validateEnvironment()` → `createSetupPlan()` → `writeOutput()` — slightly more verbose
- **No runtime adaptation**: Plan cannot adjust based on runner state (e.g., cache availability) — by design

### Neutral

- **`SetupPlan` structure**: `{ node: { shouldSetup, cache }, bun: { shouldSetup }, pnpm: { shouldSetup } }` — maps 1:1 to composite action step `if:` conditions
- **Cache key logic**: `npm` cache only when `packageManager === "npm"` and `runtime === "node"`; Bun/pnpm don't use Node cache

## Alternatives Rejected

- **Impure with filesystem access**: Couples plan to runtime state; untestable without integration harness; duplicates detection
- **Embedded in resolution**: Violates separation of concerns; makes resolution harder to test in isolation; couples to GitHub Actions API

## Related

- ADR 0001: Composite actions over reusable workflows
- ADR 0003: Validation fails on contradictory configuration
- `src/setup-plan.ts` — `createSetupPlan` implementation
- `src/resolve-environment.ts` — `writeOutput` calls `createSetupPlan`
