# Security Boundaries

This document formalizes the security architecture, input trust model, shell command tokenization, credential sanitization, and filesystem boundaries enforced across `@area44/workflows`.

## Trust Boundaries & Input Validation

- **Untrusted Inputs**: Composite action inputs (`runtime`, `build-command`, `path` in `action.yml`) and workspace configuration files (`package.json`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles) are treated as untrusted user input.
- **Fail-Fast Parsing**: Custom `runtime` inputs are parsed and validated by `parseEnvironmentInputs()` in `src/resolve-environment.ts` before environment resolution or toolchain setup takes place. Malformed inputs fail fast with `INVALID_INPUT` or `UNSUPPORTED_RUNTIME_OR_PM`.

## Command Execution & Subshell Avoidance

- **Custom Build Commands**: `src/build-command.ts` parses custom `build-command` strings using a custom tokenizer that respects single quotes, double quotes, and backslash escapes.
- **No Subshell Invocation**: Commands are executed directly as binary names and argument arrays without subshell expansion (avoiding `sh -c` or `bash -c`).
- **Injection Prevention**: Shell metacharacters (such as `;`, `&&`, `|`, `$VAR`, `>`) are treated as literal argument values, preventing shell command injection.
- **Script Runner Sanitization**: `src/lint-format.ts` sanitizes package manager names via `sanitizePackageManager()` (restricting names to alphanumeric and hyphen characters) before running script hooks.

## Credential & Token Sanitization

- **Automatic Masking**: `sanitizeCommandString()` in `src/build-command.ts` masks sensitive tokens before logging or attaching to error contexts:
  - URLs containing inline authentication credentials (`https://user:pass@host` → `https://***:***@host`).
  - Sensitive CLI option flags (`--token`, `--key`, `--api-key`, `--pat`).
  - Common access token patterns (GitHub PATs `ghp_...`, `github_pat_...`, npm tokens `npm_...`, Slack tokens `xox...`).
- **Error Context Leak Prevention**: Raw `cause` objects attached to exceptions are excluded from attached error contexts to prevent unintentional token or secret exposure.

## Source vs Generated Artifact Trust Boundary

- **Authoritative Source**: All TypeScript source code resides in `src/`.
- **Generated Outputs**: Files in `dist/` are build artifacts bundled via `npm run build` (`vp pack`). Direct manual edits to `dist/` are strictly prohibited.
- **Automated Verification**: Source-to-dist artifact synchronization is verified in CI via `npm run verify:artifacts` (`src/artifact-integrity.ts`). Direct edits to `dist/` trigger build failure.
