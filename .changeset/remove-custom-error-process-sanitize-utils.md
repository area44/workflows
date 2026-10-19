---
"@area44/workflows": major
---

refactor: remove custom errors, process-utils, and sanitize modules

- Deleted `src/errors.ts`, `src/process-utils.ts`, and `src/sanitize.ts`.
- Removed `WorkflowError`, `WorkflowErrorCode`, `WorkflowErrorContext`, `isWorkflowError`, `isExecutableAvailable`, `sanitizeCommandString`, and `sanitizeCause` exports and utility abstractions.
- Switched executable availability checks to `@actions/io.which()`.
- Migrated all error reporting to standard native JavaScript `Error` classes and `@actions/core.setFailed()`.
