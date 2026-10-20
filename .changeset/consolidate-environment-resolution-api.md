---
"@area44/workflows": patch
---

Consolidate internal environment resolution onto canonical APIs and remove obsolete legacy wrappers, aliases, and overloads.

- Removed legacy functions and aliases: `parseRuntimeInput`, `detectProjectEnvironment`, `detectRuntime`, `detectPackageManager`, `detectNodeVersion`, `detectBunVersion`, `detectEnv`, `getPnpmRuntime`, and `getDefaultPackageManagerVersion`.
- Simplified `writeOutput` signature to strictly accept `writeOutput(env: ResolvedEnvironment): void`.
- Refactored `resolvePnpmSetupRuntime` to accept `Pick<ResolvedEnvironment, "bunVersion" | "nodeVersion">`.
- Updated internal callers and test suites to exercise canonical environment resolution APIs directly.
