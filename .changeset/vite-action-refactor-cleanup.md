---
"@area44/workflows": patch
---

Refactor Autofix workflow step names and consolidate Ruff setup/linting/formatting into a single setup step and single shell step, extract executable detection (`isExecutableAvailable`) to a shared process module, completely remove the obsolete `action-contract` mechanism and dead validation code, and update documentation and build artifacts.
