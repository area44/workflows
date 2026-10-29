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

## Environment Resolution & Runtime Selection

This action automatically inspects the repository to resolve JavaScript/TypeScript and Python environments, target runtimes, package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`), and formatting/linting tools.

When `pnpm` is selected, `pnpm/setup` handles pnpm and runtime setup directly without invoking redundant dedicated `actions/setup-node` or `oven-sh/setup-bun` steps. Dedicated runtime setup steps run when other package managers (`npm` or `bun`) are selected.

For design principles, decision flow, conflict handling, and setup planning details, see the **[Environment Resolution Algorithm Guide](../docs/environment-resolution.md)**.

## Runtime and Workflow Behavior

### JavaScript Script Selection

When `package.json` is present, the action selects package scripts based on deterministic priority:

1. If a `check` script is defined, it runs `check`.
2. Otherwise, if `format` or `fmt` is defined, it runs the formatting script, followed by `lint` if defined.
3. If only `lint` is defined, it runs `lint`.

### Python Ruff Orchestration

When `.py` or `.pyi` source files exist outside excluded directories (`.venv`, `node_modules`, `dist`, `build`, `.git`, `__pycache__`), the action:

1. Resolves the Python package manager (`uv` or `pip`).
2. Provisions Ruff using `astral-sh/ruff-action`.
3. Runs `ruff check --fix .` to apply automated lint fixes.
4. Runs `ruff format .` to format Python source files.

## Constraints and Failure Behavior

- **Independent Step Diagnostics:** Failures in JavaScript or Python workflows do not immediately cancel the other workflow. Errors from both workflows are collected and reported together via `@actions/core.setFailed()`.
- **Malformed package.json:** Invalid or unparseable `package.json` files trigger an immediate execution error.

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Error Handling Architecture](../docs/errors.md)**: Native JavaScript error boundaries and `@actions/core` reporting.
- **[Security Boundaries](../docs/security.md)**: Trust boundaries, process tokenization, and command execution rules.
- **[Maintenance & Repository Health](../docs/maintenance.md)**: Source of truth files, build pipeline, and quality gates.
- **[Integration Testing Guide](../docs/integration-testing.md)**: Scenario factory, module tests, and CI matrix testing.
