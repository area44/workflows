---
"@area44/workflows": major
---

Refactor action environment outputs to explicitly ecosystem-scoped names.

### Breaking Changes

Public action outputs in `pages` and `autofix` actions have been renamed to be explicitly ecosystem-scoped:

- **JavaScript Outputs**:
  - `has-js-project` -> `has-javascript-project`
  - `runtime` -> `javascript-runtime`
  - `package-manager` -> `javascript-package-manager`
  - `package-manager-version` -> `javascript-package-manager-version`
  - `toolchain` -> `javascript-toolchain`
  - Added `javascript-runtime-version` (version of selected Node.js or Bun runtime).
  - Unscoped `node-version` and `bun-version` removed from public API.

- **Python Outputs**:
  - `python-version` -> `python-runtime-version`
  - Added `python-runtime` (`python` or empty string).
  - Retained `python-package-manager`, `has-python-source`, and `ruff-version`.
