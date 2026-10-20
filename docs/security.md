# Security Boundaries

This document formalizes the security architecture, input trust model, shell command tokenization, and filesystem boundaries enforced across `@area44/workflows`.

## Trust Boundaries & Input Validation

- **Untrusted Inputs**: Composite action inputs (`runtime`, `build-command`, `path` in `action.yml`) and workspace configuration files (`package.json`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles) are treated as untrusted user input.
- **Fail-Fast Parsing**: Custom `runtime` inputs are parsed and validated by `parseEnvironmentInputs()` in `src/resolve-environment.ts` before environment resolution or toolchain setup takes place. Malformed inputs fail fast with descriptive native errors.

## Command Execution & Subshell Avoidance

- **Action Bootstrap Runtime**: Internal bundled action entrypoints (`dist/resolve-environment.mjs`, `dist/site-variables.mjs`, `dist/build-command.mjs`, `dist/autofix.mjs`) execute directly under Node.js.
- **Project Commands Execution**: Project commands are executed via `@actions/exec` using binary names and tokenized argument arrays derived from the resolved project package manager and configuration.
- **Custom Build Commands**: `src/pages/build-command.ts` parses custom `build-command` strings using a custom tokenizer that respects single quotes, double quotes, and backslash escapes.
- **No Subshell Invocation**: Commands are executed directly as binary names and argument arrays without subshell expansion (avoiding `sh -c` or `bash -c`).
- **Injection Prevention**: Shell metacharacters (such as `;`, `&&`, `|`, `$VAR`, `>`) are treated as literal argument values, preventing shell command injection.
- **Script Runner Validation**: Package manager names are sanitized via `sanitizePackageManager()` (restricting names to alphanumeric and hyphen characters) before running script hooks.

## Secret Masking & Error Reporting

- **Native Error Reporting**: Rather than relying on custom regex-based token masking, action steps throw concise native `Error` instances and report failures via `@actions/core.setFailed()`.
- **GitHub Actions Secret Masking**: Credentials and secrets registered with GitHub Actions or passed via secret environment variables are automatically masked by the GitHub Actions runner.
- **Minimal Verbosity**: Error messages avoid dumping raw environment blocks or unrestricted process outputs.

## Source vs Generated Artifact Trust Boundary

- **Authoritative Source**: All TypeScript source code resides in `src/`.
- **Generated Outputs**: Files in `dist/` are build artifacts bundled via `npm run build` (`vp pack`) used as executable entrypoints for composite GitHub Actions.
