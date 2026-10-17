---
"@area44/workflows": patch
---

Refactor process utilities by moving executable detection (`isExecutableAvailable`) to a shared process module, completely remove the obsolete `action-contract` mechanism and `DetectedEnv` type alias, and update unified `vite/action` documentation and build artifacts for the v8 release line.
