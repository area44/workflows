---
"@area44/workflows": major
---

Remove public `runtime` input from `pages` and `autofix` actions. Project runtime selection is now automatically derived from project configuration files (`package.json`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles) and established defaults. The `runtime` output remains available to report the detected runtime.
