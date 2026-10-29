# area44/autofix

Automatically format and fix code.

## Action Purpose

The `autofix` composite action automatically formats and fixes code.

## Features and Supported Behavior

- **Automatic Environment Detection:** Automatically detects Node.js, Bun, and Python environments and package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`).
- **Dependency Synchronization:** Synchronizes dependencies and lockfiles when a supported JavaScript or Python project configuration is present.
- **JavaScript/TypeScript Project Scripts:** Selects and executes repository-configured scripts (`check`, `format`, `fmt`, `lint`) from `package.json`.
- **Python Formatting and Linting:** Provisions Ruff and executes `ruff check --fix .` and `ruff format .` sequentially whenever Python source code (`.py`/`.pyi`) is detected.
- **Independent Execution:** JavaScript and Python workflows run independently within the same action step, aggregating diagnostics and failures.
- **autofix.ci Integration:** Automatically invokes `autofix-ci/action` when running inside the `autofix.ci` workflow context.

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

## Public API Contract

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

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Environment Resolution Algorithm Guide](../docs/environment-resolution.md)**: Design principles, decision flow, conflict handling, and setup planning details.
- **[Error Handling Architecture](../docs/errors.md)**: Native JavaScript error boundaries, top-level error handling, and error logging.
- **[Security Boundaries](../docs/security.md)**: Input sanitization, argument tokenization, and command execution boundaries.
- **[Maintenance & Repository Health](../docs/maintenance.md)**: Maintenance workflows, build scripts, and quality gates.
- **[Integration Testing Guide](../docs/integration-testing.md)**: Module integration testing, fixture generators, and CI test harnesses.
