# ADR 0003: Validation Fails on Contradictory Configuration

**Status**: Accepted
**Date**: 2024-01-15

## Context

Environment resolution detects multiple signals for runtime and package manager. When signals contradict (e.g., `.bun-version` file AND `.nvmrc` file; `packageManager: bun` in `package.json` but Node.js `devEngines`), we must decide: **fail fast** or **apply a silent tie-breaker**.

Current behavior: **Fail validation** (`core.setFailed`) with a descriptive error message.

Examples:

- "Conflicting runtime version files detected: found both .bun-version and Node.js version file (.nvmrc)."
- "Conflicting runtime configuration: packageManager indicates Bun but package.json devEngines specifies Node.js runtime."

## Decision

**Fail validation on contradictory configuration** rather than silently picking a winner.

## Consequences

### Positive

- **Explicit over implicit**: Repository owners must resolve ambiguity; no surprise behavior
- **Fail early**: Misconfiguration caught at workflow start, not during cryptic downstream failures
- **Actionable errors**: Error messages name the conflicting files/fields; owner knows exactly what to fix
- **No hidden precedence**: The precedence rules (devEngines > version files > packageManager > default) only apply when signals are **consistent** or **absent**

### Negative

- **Strictness**: Repos with legacy/accidental config (e.g., leftover `.nvmrc` in a Bun project) fail until cleaned up
- **Migration friction**: Adopting teams must audit and clean config before first successful run

### Neutral

- **Undetected domains succeed**: A repo with neither JS nor Python config logs "No JavaScript or Python environment detected." and **succeeds** — absence is not an error
- **Single-signal wins**: If only one signal exists (e.g., only `pnpm-lock.yaml`), it wins without conflict

## Alternatives Rejected

- **Silent tie-breaker (last wins / first wins / highest precedence wins)**: Hides misconfiguration; causes "works on my machine" vs CI discrepancies; violates principle of least surprise
- **Warning + proceed**: GitHub Actions has no "warning" output that doesn't fail the step; would require custom annotation parsing

## Related

- ADR 0004: Runtime precedence order (devEngines > version files > packageManager > default)
- `docs/environment-resolution.md` — Conflict handling rules
- `src/javascript-env/runtime-resolver.ts` — `validateRuntimeConflicts` implementation
