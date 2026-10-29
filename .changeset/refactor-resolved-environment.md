---
"@area44/workflows": major
---

Refactor resolved environment architecture to use ecosystem-owned models (`ResolvedJavaScriptEnvironment` and `ResolvedPythonEnvironment`) under a unified `ResolvedEnvironment` aggregate contract.

### Public Action Output Renames (Breaking Change)

The public GitHub Actions outputs for `pages` and `autofix` actions have been standardized with ecosystem prefixes:

#### JavaScript Outputs:

- `javascript-detected` (replaces legacy `has-js-project`)
- `javascript-runtime` (replaces generic `runtime`)
- `javascript-runtime-version` (replaces `node-version` / `bun-version` in public outputs)
- `javascript-package-manager` (replaces `package-manager`)
- `javascript-package-manager-version` (replaces `package-manager-version`)
- `javascript-toolchain` (replaces `toolchain`)

#### Python Outputs:

- `python-detected` (replaces legacy `has-python-source`)
- `python-version`
- `python-package-manager`
- `ruff-version`

Internal setup outputs (`node-version`, `bun-version`, `setup-node`, `setup-bun`, `setup-pnpm`, `setup-python`) remain retained internally for step orchestration in composite actions.
