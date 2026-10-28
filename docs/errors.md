# Error Handling Architecture

This document defines the error handling architecture, native error propagation, top-level entry point boundaries, build failure logging, and `@actions/core` failure reporting across `@area44/workflows`.

## Purpose and Scope

This specification governs how errors are generated, caught, propagated, logged, and reported to GitHub Actions runner environments across composite actions (`pages`, `autofix`) and core resolution modules.

## Native JavaScript Error Propagation

All internal modules throw standard native JavaScript `Error` instances containing clear, actionable, and context-rich messages. Custom error classes, error wrapping utilities, or custom regex-based string sanitizers are avoided in favor of direct native exceptions.

### Core Failure Reporting

Action steps report failures to the GitHub Actions runner using official `@actions/core` APIs:

- `core.setFailed(message)`: Marks the current workflow step as failed and displays the provided error message in the step summary.
- `core.error(message)`: Emits inline error log annotations when appropriate.

## Entry Point Boundaries

Bundled executable action entrypoints (`dist/resolve-environment.mjs`, `dist/site-variables.mjs`, `dist/build-command.mjs`, `dist/autofix.mjs`) wrap execution inside top-level `try/catch` error boundaries:

1. **`resolve-environment`**: Catches invalid `runtime` inputs, unparseable project manifests, or package manager resolution conflicts, triggering `core.setFailed()` with the exact error message.
2. **`site-variables`**: Validates `GITHUB_REPOSITORY` and `GITHUB_REPOSITORY_OWNER` environment variables. Emits warnings if repository metadata is missing or malformed without failing the job when possible.
3. **`build-command`**: Wraps build command parsing, CLI execution, and output directory validation. Catches non-zero process exit codes and missing build output directories.
4. **`autofix`**: Wraps independent JavaScript and Python workflow steps, aggregating errors across both pipelines before reporting final step outcomes via `core.setFailed()`.

## Build Failure Logging (`pages_build_error.log`)

For machine-verifiable assertions in CI workflows, `runBuildCommand()` in `src/pages/build-command.ts` captures build failures:

- **Log File Location**: When the `RUNNER_TEMP` environment variable is set by the runner, failure details are written to `${RUNNER_TEMP}/pages_build_error.log`.
- **Diagnostic Coverage**: Captures non-zero exit codes from custom or default build commands (e.g., `"Build command execution failed with exit code 1"`) and output path validation errors (e.g., `"Build output validation failed: Configured build output directory 'dist' does not exist."`).
- **CI Verification**: Integration workflows like `.github/workflows/test-actions.yml` assert step failure status and verify the exact contents of `${RUNNER_TEMP}/pages_build_error.log` for negative scenario matrix jobs.

## Operational Invariants

1. **No Silent Failures**: Any unhandled exception during resolution or execution MUST terminate the action step with a non-zero exit code.
2. **Aggregated Diagnostics**: In multi-language workflows (`autofix`), failure in one language pipeline does not immediately suppress execution or error reporting from other active pipelines. All accumulated errors are logged prior to setting step failure.

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Security Boundaries](./security.md)**: Input trust model, command execution without subshell, and secret masking.
- **[Maintenance & Repository Health](./maintenance.md)**: Source of truth files, build pipeline, and quality gates.
- **[Integration Testing Guide](./integration-testing.md)**: Integration test matrix and failure mode verification.
