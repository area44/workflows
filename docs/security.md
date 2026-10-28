# Security Boundaries

This document formalizes the security architecture, input trust model, shell command tokenization, argument execution boundaries, and secret masking enforced across `@area44/workflows`.

## Purpose and Scope

This document specifies the security boundaries and defensive measures implemented in `@area44/workflows` to prevent command injection, unsafe input processing, and secret leakage during GitHub Actions execution.

## Trust Boundaries & Input Validation

- **Untrusted User Inputs**: Composite action inputs (`build-command`, `path`) supplied in workflow files and repository manifest files (`package.json`, `pyproject.toml`, `uv.toml`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles) are treated as untrusted user input.
- **Package Manager Sanitization**: Package manager identifiers are sanitized before executing package manager binaries, restricting characters to alphanumeric names and hyphens.

## Command Execution & Subshell Avoidance

- **Action Bootstrap Runtime**: Internal bundled action entrypoints (`dist/resolve-environment.mjs`, `dist/site-variables.mjs`, `dist/build-command.mjs`, `dist/autofix.mjs`) execute directly under Node.js without shell wrappers.
- **Binary Tokenization**: Project build and autofix commands are executed via `@actions/exec` using distinct binary names and argument arrays derived from resolved project tools (e.g. `npm`, `pnpm`, `bun`, `vp`, `ruff`).
- **Custom Build Command Parsing**: `src/pages/build-command.ts` parses custom `build-command` strings using a custom tokenizer respecting single quotes, double quotes, and backslash escapes.
- **Subshell Avoidance**: Commands are executed directly as binary executable paths and argument arrays without subshell invocation (avoiding `sh -c` or `bash -c`).
- **Command Injection Prevention**: Shell metacharacters (such as `;`, `&&`, `|`, `$VAR`, `>`) are treated as literal argument strings rather than shell control operators, preventing command injection vulnerabilities.

## Secret Masking and Process Isolation

- **GitHub Actions Secret Masking**: Credentials, tokens, or secret values registered with the GitHub Actions runner environment (or passed via secret environment variables) are automatically masked by the runner's native secret redaction mechanisms.
- **Minimal Error Verbosity**: Native exceptions and failure reports avoid dumping raw environment variable maps or unredacted internal memory buffers into public workflow logs.

## Source vs Generated Artifact Trust Boundary

- **Authoritative Source**: All TypeScript logic, environment resolution, and action orchestration code reside strictly in `src/`.
- **Bundled Executable Artifacts**: Artifacts under `dist/` are generated from `src/` via `npm run build` (`vp pack`).
- **CI Consistency Check**: The `check-dist` job in `.github/workflows/ci.yml` enforces zero drift between `src/` and `dist/`, ensuring untracked or stale build artifacts cannot be committed unnoticed.

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Error Handling Architecture](./errors.md)**: Native JavaScript error handling and failure reporting.
- **[Maintenance & Repository Health](./maintenance.md)**: Source files, build pipeline, and quality gates.
- **[Integration Testing Guide](./integration-testing.md)**: Test scenario generation and matrix testing.
