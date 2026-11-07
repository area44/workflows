# area44/autofix

Automatically format and fix code across JavaScript, TypeScript, and Python projects.

## Overview

The `autofix` action automatically formats and applies safe code fixes to your project:

- **Python:** Uses Ruff as the default toolchain to lint and format code whenever Python source files (`.py`/`.pyi`) are present.
- **JavaScript & TypeScript:** Automatically prioritizes explicit package scripts (e.g., `format:write`, `lint:fix`, `fix`) while detecting configured tools (Prettier, ESLint, Biome, Oxlint, Oxfmt, Vite+).
- **Check-Mode Safety:** In check mode, only non-writing verification commands are scheduled; write-capable scripts (such as `format`, `fmt`, or scripts with `--fix`/`--write`) are never executed.
- **Conflict Prevention:** Detects overlapping tools and deduplicates execution so files are not formatted or linted multiple times redundantly.
- **autofix.ci Support:** Automatically integrates with `autofix-ci/action` when running in autofix.ci contexts.

## Usage Example

```yaml
name: autofix.ci

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: read

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Run autofix
        uses: area44/workflows/autofix@main
```

## Public Action Contract

### Inputs

This action accepts no inputs.

### Outputs

| Name                         | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `javascript-detected`        | Whether a JavaScript project (`package.json`) was detected |
| `javascript-runtime`         | The resolved JavaScript runtime (`node` or `bun`)          |
| `javascript-package-manager` | The package manager used (`npm`, `pnpm`, or `bun`)         |
| `python-detected`            | Whether Python source code (`.py`/`.pyi`) was detected     |
| `python-package-manager`     | The Python package manager detected (`uv` or `pip`)        |
