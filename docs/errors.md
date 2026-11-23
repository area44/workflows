# Error Handling

How errors are thrown, propagated, and reported across the composite actions and resolution modules.

## Propagation

Modules throw native `Error` instances with actionable messages. There are no custom error classes or error-wrapping utilities; `core.setFailed(message)` and `core.error(message)` report failures to the runner.

Each bundled entrypoint wraps its work in a top-level boundary:

- `dist/resolve-environment.mjs` — catches unparseable manifests and package-manager conflicts.
- `dist/pages/site-variables.mjs` — warns (does not fail) on missing or inconsistent `GITHUB_REPOSITORY` / `GITHUB_REPOSITORY_OWNER`.
- `dist/pages/build-command.mjs` — catches non-zero build exit codes and output-directory validation errors.
- `dist/autofix.mjs` — runs JavaScript and Python independently and aggregates their errors before failing the step.

## Build failure log

`runBuildCommand()` in `src/pages/build-command.ts` writes failure details to `${RUNNER_TEMP}/pages_build_error.log` (when `RUNNER_TEMP` is set) so CI can assert the reason. Messages:

- `Build command execution failed with exit code <n>.`
- `Build output validation failed: <reason>` (e.g. `Configured build output directory 'dist' does not exist.`)

`.github/workflows/test-actions.yml` asserts both the exit code and the exact log contents for negative scenarios.

## Invariants

- **No silent failures** — any unhandled error terminates the step non-zero.
- **Aggregated diagnostics** — in `autofix`, one language's failure does not suppress the other; all errors are logged before `setFailed`.
