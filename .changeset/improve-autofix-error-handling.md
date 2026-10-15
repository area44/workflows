---
"@area44/workflows": patch
---

Improve Autofix error handling, logging, and file safety by throwing structured `WorkflowError` instances (`COMMAND_EXECUTION_FAILURE`, `SETUP_FAILURE`, `MISSING_CONFIGURATION`) with sanitized command strings and cause messages, propagating error state cleanly via `core.setFailed`, and preserving workspace files on failure.
