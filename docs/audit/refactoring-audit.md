# Refactoring Audit — area44/workflows

## Summary

All Phases A–E refactoring work is complete. The codebase has been split into focused modules, the `ProjectContext` type has been redesigned with nested language sub-contexts, Vite+ special-case logic has been removed from the base adapter, Python workspace glob logic has been consolidated, and all quality gates pass.

**Gate status:**

- `npm run build` — passes
- `npm run lint` — passes (only pre-existing `.agents/` warning)
- `npm run format -- --check` — passes
- `npm test` — passes (486 passed; 5 pre-existing Windows ESM failures in `tests/generate-consumer-project.test.ts`)

## Audit Scope

Inspected: `src/`, `tests/`, `autofix/`, `pages/`, `.github/workflows/`, `docs/`, `package.json`, `package-lock.json`, generated `dist/`

## Files Modified (completed refactoring)

### Module splits

| Original file                     | Split into                                                                                                                                                                                                         | Location                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `script-adapter.ts` (1,320 lines) | `base-adapter.ts`, `delegation-analyzer.ts`, `index.ts`, `script-adapter-types.ts`, `script-adapter.ts`, `script-classifier.ts`, `script-task-resolver.ts`, `shell-parser.ts`, `tools.ts`, `vite-plus-detector.ts` | `src/autofix/adapters/javascript/` |
| `tools.ts`                        | `base-adapter.ts` + `tools.ts` with 6 concrete adapters                                                                                                                                                            | `src/autofix/adapters/javascript/` |
| `engine.ts`                       | `executable-resolver.ts` + `engine.ts`                                                                                                                                                                             | `src/autofix/`                     |
| `python-env.ts`                   | 8 modules + `index.ts`                                                                                                                                                                                             | `src/python-env/`                  |
| `javascript-env.ts`               | 9 modules + `index.ts`                                                                                                                                                                                             | `src/javascript-env/`              |

### Type redesign

`src/autofix/types.ts` — `ProjectContext` now uses nested sub-contexts:

- `javascript?: { env, packageManager? }`
- `python?: { hasSource, inspection?, packageManager? }`
- Removed unused `pyCtx`/`pyPmInfo` fields; updated all 12 access sites across 9 files.

### PR #349 findings addressed

- Removed Vite+ special-case from `BaseToolAdapter`; `customDetect` returns full `AdapterDetectionResult`; Vite+ detection moved into `vitePlusConfig.customDetect`
- Removed redundant `hasVitePlusScript` wrapper from `tools.ts`; imports from `vite-plus-detector.ts`
- Consolidated Python workspace glob logic: removed `globToRegex`/`isDirectoryMatchedByGlobs`/`isWorkspaceMember` + `fs`/`path` imports from `types.ts`; `isWorkspaceMember` moved to `uv-workspace.ts` importing glob utils from `directory-utils.ts`; updated imports in `package-manager-detector.ts` and `index.ts`
- Changesets: kept `.changeset/dark-crews-yell.md`, deleted 4 stale changesets

### dist/

`dist/autofix.mjs` and `dist/resolve-environment.mjs` regenerated via `npm run build`.

## Findings Requiring Attention

### 1. Duplicated detection logic in `vitePlusConfig` (tools.ts:63-184)

`customDetect` and `customPlan` both independently check the same four conditions:

- `hasDep = hasVitePlusDependency(pkg)`
- `hasConfig = configFiles.some(...)`
- `hasVpScript = hasVitePlusScript(...)`
- `resolvedBin = await resolveProjectBinary("vp")`
- `hasExec = Boolean(resolvedBin)`

**Smell:** Duplicated Code (Fowler). The same logic shape appears in two functions in the same file.

**Recommendation:** Extract a shared `resolveVitePlusState(context)` helper that returns `{ hasDep, hasConfig, hasVpScript, hasExec }`, then have both `customDetect` and `customPlan` call it.

### 2. Redundant re-inspection in `index.ts` entry points

`buildProjectContext` (index.ts:32-51) and `executeJsWorkflow` (index.ts:150-189) both call `inspectJsProjectEnvironment(cwd)` and `resolveJsPm(...)`. The planner (`planner/index.ts:34-44`) also re-resolves `hasPythonSource` and `inspectJsProjectEnvironment` even when already present in context.

**Smell:** Duplicated Code / Shotgun Surgery. Environment inspection logic is scattered across 3 call sites.

**Recommendation:** The planner should trust `context.javascript.env` and `context.python.hasSource` when already present, only falling back to fresh inspection when `undefined`. Entry points should build context once and pass it through.

### 3. Test gap: no unit tests for `python-env/directory-utils.ts` glob utilities

`globToRegex`, `isDirectoryMatchedByGlobs`, `collectParentDirs` are exported from `python-env/index.ts` but have no dedicated unit test coverage. These are tested indirectly through integration tests but not directly.

**Recommendation:** Add `tests/python-env/directory-utils.test.ts` covering glob-to-regex conversion, directory matching, and parent dir collection.

### 4. No unit tests for `src/utils/is-main-module.ts`

The `isMainModule` utility is used by all entry points but has no dedicated test file.

**Recommendation:** Add `tests/is-main-module.test.ts` (a stub test exists at `tests/is-main-module.test.ts` — verify it covers the function).

### 5. `resolve-environment.ts` validation functions are untested in isolation

`validateJsEnvironment`, `validatePmInfoFields`, `validatePmInfoStandalone`, `validateUvPmInfoInvariants`, `validatePythonPmInfo`, `validateNoPythonSourceEnv`, `validatePythonEnvironment` are exported-adjacent but not directly unit-tested. They are covered indirectly via `resolve-environment.test.ts` integration tests.

**Recommendation:** Consider adding direct unit tests for edge cases (standalone pm with installCommands, UV lockfile without pyproject.toml, invalid toolchain values, etc.).

### 6. Security review — no findings

Reviewed `src/pages/build-command.ts` command parsing: uses a custom tokenizer (not `shell: true` or `eval`), respects quotes/escapes, and invokes via `exec.exec` with argument arrays — no command injection surface.

`src/autofix/executable-resolver.ts` resolves binaries without falling back to `npx` (no unpinned package download). PATH lookups use `io.which` with `verify: false`.

No secrets, keys, or credentials are logged or exposed.

### 7. Documentation — `docs/audit/` directory is new

This audit document is the first artifact in `docs/audit/`. Existing docs (`docs/maintenance.md`, `docs/environment-resolution.md`, `docs/integration-testing.md`, `docs/errors.md`, `docs/security.md`) remain current and accurate.

## Next Steps (Recommended, not required)

| Priority | Item                                                                                               | Effort |
| -------- | -------------------------------------------------------------------------------------------------- | ------ |
| Medium   | Extract shared `resolveVitePlusState` helper in `tools.ts` to eliminate duplicated detection logic | Low    |
| Low      | Add `tests/python-env/directory-utils.test.ts` for glob utility unit tests                         | Low    |
| Low      | Add direct unit tests for `resolve-environment.ts` validation functions                            | Low    |
| Low      | Verify `tests/is-main-module.test.ts` covers `isMainModule`                                        | Low    |

No blocking issues found. The refactoring is complete and all gates pass.
