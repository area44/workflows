# Versioning Model

This document defines how repository versions are managed, validated, and classified across `@area44/workflows`.

## Authoritative Version Source

- **Single Source of Truth**: The `version` property in `package.json` is the single authoritative source of repository versioning.
- **Lockfile Synchronization**: The `version` property in `package-lock.json` must remain strictly synchronized with `package.json`.
- **No Duplicate Sources**: No secondary version constants or duplicate version files are maintained.
- **Verification Engine**: `validateRepositoryVersion()` in `src/versioning.ts` verifies version validity and lockfile synchronization.

## Semantic Versioning Rules

Repository versioning strictly adheres to Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`).

## Change Impact Classification

Changes are classified into SemVer impact categories via `classifyChangeImpact()` in `src/versioning.ts`:

### Patch Releases

Patch releases represent backward-compatible bug fixes and non-functional updates:

- Internal implementation fixes and error handling refinements.
- Documentation updates that do not alter execution contracts or public interfaces.
- Refactoring that preserves public action contracts (`action.yml`) and compatibility matrix contracts.

### Minor Releases

Minor releases introduce backward-compatible new capabilities:

- Addition of new optional action inputs (`required: false`) in `action.yml`.
- Addition of new action outputs in `action.yml`.
- Addition of newly supported runtime or package manager matrix combinations in `CANONICAL_COMPATIBILITY_MODEL`.

### Major Releases

Major releases contain breaking API or compatibility changes:

- Removal of public action inputs or outputs from `action.yml`.
- Changing an action input from optional (`required: false`) to required (`required: true`).
- Changing the default value of an action input.
- Removal or deprecation of supported matrix combinations in `CANONICAL_COMPATIBILITY_MODEL`.
- Any backward-incompatible behavioral change violating public API or error contracts.

## Machine Verification

Repository versioning invariants are enforced automatically locally and in CI via:

```bash
npm run verify:version
```
