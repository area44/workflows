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

| Name                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `node-version`            | The Node.js version used                                              |
| `bun-version`             | The Bun version used                                                  |
| `package-manager`         | The package manager used                                              |
| `package-manager-version` | The version of the package manager used                               |
| `runtime`                 | The runtime used (node or bun)                                        |
| `has-js-project`          | Whether a JavaScript project (package.json) was detected              |
| `has-python-source`       | Whether Python source code was detected                               |
| `python-version`          | The Python version used                                               |
| `python-package-manager`  | The Python package manager detected (uv or pip)                       |
| `ruff-version`            | The Ruff version specified by the project or empty string for default |

## Project Runtime Resolution

Project environment resolution distinguishes between three independent concepts:

- **Project Runtime:** The JavaScript execution environment (`node` or `bun`).
- **Runtime Version:** The version of Node.js or Bun to provision (e.g. `24` or `1.4.0`).
- **Package Manager:** The package manager binary used for dependency installation (`npm`, `pnpm`, or `bun`).

### Conflict Validation & Resolution Precedence

All project configuration signals are validated for contradictions before selecting a runtime. Contradictory runtime declarations (e.g. declaring both `devEngines.node` and `devEngines.bun` in `package.json`, or pairing `.bun-version` with `devEngines.node`) produce an explicit configuration error rather than silently choosing one runtime.

After conflict validation, runtime selection follows deterministic precedence:

1. **Bun Package Manager:** If `packageManager` or `devEngines.packageManager` is `bun@...`, or if `bun.lock` exists, Bun runtime is selected.
2. **`package.json` `devEngines`:** Declarations in `devEngines.bun` select Bun; `devEngines.node` select Node.js.
3. **Version Files:** A `.bun-version` file selects Bun runtime; an `.nvmrc` or `.node-version` file selects Node.js runtime.
4. **Default Fallback:** Defaults to Node.js runtime (`node@24`) when no explicit Bun runtime signals exist.

### Package Manager Compatibility

Bun runtime supports both `bun` and `pnpm` package managers. For example, a project using `pnpm` with Bun runtime is valid:

```json
{
  "packageManager": "pnpm@12.15.0",
  "devEngines": {
    "bun": "1.4.0"
  }
}
```

Pairing Bun runtime with `npm` package manager is unsupported and triggers an explicit validation failure.

## Runtime and Workflow Behavior

### JavaScript Script Selection

When `package.json` is present, the action selects package scripts based on deterministic priority:

1. If a `check` script is defined, it runs `check`.
2. Otherwise, if `format` or `fmt` is defined, it runs the formatting script, followed by `lint` if defined.
3. If only `lint` is defined, it runs `lint`.

### Python Ruff Orchestration

When `.py` or `.pyi` source files exist outside excluded directories (`.venv`, `node_modules`, `dist`, `build`, `.git`, `__pycache__`), the action:

1. Resolves the target Python version and package manager (`uv` or `pip`).
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
