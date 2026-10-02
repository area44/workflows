# Error Contract

This document defines the error handling architecture, structured error types, error codes, and fail-fast semantics for `@area44/workflows`.

## Structured Error Class

All repository errors derive from `WorkflowError` (extending `Error`) defined in `src/errors.ts`. `WorkflowError` instances contain:

- `code`: Specific `WorkflowErrorCode` value.
- `message`: Human-readable error message describing the failure cause and context.
- `context`: Structured `WorkflowErrorContext` payload containing diagnostic details (`action`, `stage`, `resource`, `path`, `cause`). Sensitive credentials and raw cause objects are sanitized.

## Fail-Fast Error Codes

The repository formalizes six explicit error codes (`WorkflowErrorCode`):

### `INVALID_INPUT`

Raised when action inputs, configuration values, version strings, or command inputs are malformed, duplicate, or invalid.
Examples: malformed `runtime` inputs (e.g. `node@`, `node,,bun`), duplicate runtime specifiers, unterminated quotes in custom build commands, or invalid SemVer strings.

### `UNSUPPORTED_RUNTIME_OR_PM`

Raised when an unrecognized runtime or package manager name is supplied or detected.
Examples: specifying `deno` as a runtime or `yarn` as a package manager.

### `UNSUPPORTED_COMBINATION`

Raised when a runtime and package manager combination is unsupported by `CANONICAL_COMPATIBILITY_MODEL`.
Example: attempting to execute Bun runtime mode with `npm` package manager (`bun` + `npm`).

### `MISSING_CONFIGURATION`

Raised when mandatory workspace configuration files, required fields, entry source files, or baseline git refs are missing.
Examples: missing `package.json`, missing `version` field in `package.json`, or unresolvable base ref in upgrade guardrails.

### `SETUP_FAILURE`

Raised when toolchain setup adapter processing or environment resolution fails during execution.

### `COMMAND_EXECUTION_FAILURE`

Raised when underlying build commands, lint/format scripts, or shell execution processes fail with non-zero exit codes. Non-zero exit codes are never swallowed or converted to success.
