---
"@area44/workflows": patch
---

Refactor autofix to a provider-owned, tool-agnostic architecture: language providers own their setup and execution lifecycle, tasks are routed by `providerId` instead of tool id, the execution engine resolves executables via declarative strategies (`passthrough`/`path`/`project-binary`), and every executed command is logged once as `Executing: <command>` with quoted arguments (removing duplicate and verbose environment-summary logs).
