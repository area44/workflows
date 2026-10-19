# Error Handling

This document defines the error handling architecture, native error propagation, and `@actions/core` reporting across `@area44/workflows`.

## Native JavaScript Error Handling

All error conditions in `@area44/workflows` throw standard native JavaScript `Error` instances with clear, actionable error messages.

Action steps catch exceptions at the top-level execution boundaries (`run()`) and report failures using `@actions/core`:

- `core.setFailed(message)`: Marks the action execution step as failed with the error message.
- `core.error(message)`: Logs step-level error annotations when appropriate.

## Action Entry Boundaries

Each entry point (`resolve-environment`, `autofix`, `build-command`) maintains a lightweight top-level error boundary to prevent unhandled promise rejections or unhandled exceptions, ensuring non-zero exit codes when an operation fails.
