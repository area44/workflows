# area44/lint-format

Run linting and formatting scripts for JavaScript/TypeScript and Python projects with automatic language detection and autofix support.

## Usage

```yaml
name: autofix.ci # needed to securely identify the workflow

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: write

jobs:
  lint-format:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run lint and format
        uses: area44/workflows/lint-format@main
```

### Usage Examples

#### JavaScript and TypeScript Only

```yaml
jobs:
  lint-format:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run lint and format
        uses: area44/workflows/lint-format@main
```

#### Python Only

```yaml
jobs:
  lint-format:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run lint and format
        uses: area44/workflows/lint-format@main
```

#### Mixed JavaScript and Python

```yaml
jobs:
  lint-format:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run lint and format
        uses: area44/workflows/lint-format@main
```

## Language Detection

The `lint-format` action automatically detects project languages and executes only the applicable toolchains:

- **JavaScript/TypeScript**: Enabled when `package.json` exists in the repository root.
- **Python**: Enabled when Python source files (`*.py` or `*.pyi`) are present in non-excluded project directories.
- **Neither**: Succeeds with an informational message if neither language is detected.

### JavaScript and TypeScript Behavior

When `package.json` is present, the action resolves the JS runtime and package manager and executes matching scripts defined in `package.json`:

1. `check`
2. `format` and `lint`
3. `fmt` and `lint`
4. Individual `format`, `fmt`, or `lint` scripts

### Python and Ruff Behavior

When Python source files are present, the action sets up Python and runs Ruff:

- **Ruff Configuration**: Discovered automatically from `ruff.toml`, `.ruff.toml`, or `[tool.ruff]` in `pyproject.toml`. If no configuration file exists, Ruff runs with safe defaults.
- **Python Version Resolution**: Resolved from `.python-version` or `pyproject.toml` (`requires-python`), falling back to default Python version `3.12`.
- **Ruff Version Resolution**: Resolved from project configuration (`pyproject.toml` or `requirements.txt`), falling back to default pinned Ruff version `0.9.10`.

## Autofix vs Check-Only Behavior

- **Autofix Mode**: When running under a workflow named `autofix.ci`, Ruff executes `ruff check --fix .` followed by `ruff format .`.
- **Check-Only Mode**: For standard CI runs, Ruff executes `ruff check .` followed by `ruff format --check .` without modifying source files.

## Compatibility

See the repository **[Compatibility Contract & Release Policy](../COMPATIBILITY.md)** for supported toolchain versions, package managers, and matrix coverage.

## Inputs

| Name      | Description                                                   | Default | Required |
| --------- | ------------------------------------------------------------- | ------- | -------- |
| `runtime` | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |

## Outputs

| Name                      | Description                                |
| ------------------------- | ------------------------------------------ |
| `node-version`            | The Node.js version used                   |
| `bun-version`             | The Bun version used                       |
| `package-manager`         | The package manager used                   |
| `package-manager-version` | The version of the package manager used    |
| `runtime`                 | The runtime used (node or bun)             |
| `has-js`                  | Whether JavaScript/TypeScript was detected |
| `has-python`              | Whether Python/Ruff was detected           |
| `python-version`          | The Python version used                    |
| `ruff-version`            | The Ruff version used                      |

## Detection Limitations & Monorepo Behavior

- Python source file scanning traverses root and subdirectories while skipping standard excluded paths (`node_modules`, `.venv`, `venv`, `.git`, `dist`, `build`, `.tox`, `__pycache__`, etc.).
- Repositories containing configuration files without active Python source files bypass Python toolchain setup to avoid unnecessary step execution.
