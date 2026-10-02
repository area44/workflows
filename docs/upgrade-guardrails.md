# Upgrade Guardrails

This document describes the upgrade guardrail mechanisms that prevent accidental breaking changes and compatibility regressions across `@area44/workflows`.

## Purpose & Scope

Upgrade guardrails inspect modifications made between a target branch and a baseline git commit to ensure contract changes match declared version impact levels before publication or PR merging.

## Baseline Revision Resolution

Baseline git ref resolution is governed by `resolveBaseRef()` in `src/upgrade-guardrails.ts`:

- **Deterministic Resolution Chain**: Evaluates candidates in exact order:
  1. Explicit `baseRef` parameter passed to verification functions.
  2. `UPGRADE_BASE_REF` environment variable.
  3. `BASE_REF` environment variable.
  4. `GITHUB_BASE_REF` environment variable.
  5. `GITHUB_EVENT_BEFORE` environment variable.
  6. `origin/main` git ref.
  7. `main` git ref.
- **Git Ref Validation**: Each candidate ref is validated via `git rev-parse --verify`.
- **Prohibited Contract Guessing**: Baseline contract guessing via relative commits (such as `HEAD~1`) is strictly prohibited. If no valid base ref is resolved, verification fails fast with `MISSING_CONFIGURATION`.

## Verified Contracts

Upgrade guardrails compare target contracts against baseline contracts for:

- **Public Action API Contracts**: Parses `action.yml` across composite actions (`astro`, `vite`, `vite-plus`, `lint-format`) to detect removed inputs/outputs, newly required inputs, or default value modifications.
- **Compatibility Matrix Contracts**: Compares `CANONICAL_COMPATIBILITY_MODEL` entries to detect removed or unsupported runtime/package-manager combinations.
- **SemVer Impact Validation**: Computes required SemVer impact level (`patch`, `minor`, `major`) via `classifyChangeImpact()` and asserts that `package.json` target version satisfies the required impact over the baseline version.

## Local & CI Execution

Upgrade guardrails are verified in CI workflows (`.github/workflows/ci.yml`) and can be executed locally:

```bash
npm run verify:upgrade
```
