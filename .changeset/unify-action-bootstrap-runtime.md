---
"@area44/workflows": patch
---

refactor: unify action bootstrap runtime across all composite actions

- Standardize Node.js as the common action bootstrap runtime for executing internal bundled `.mjs` entrypoints across all composite actions.
- Remove conditional executable selection for internal action entrypoints based on `RUNTIME`.
- Preserve distinct canonical project outputs `RUNTIME` and `PACKAGE_MANAGER` for executing project dependency installation and build scripts.
- Hardened step outcome conditions across composite action steps in `pages/action.yml` and `autofix/action.yml`.
