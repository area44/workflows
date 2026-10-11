# area44/lint-format

Run linting and formatting scripts for JavaScript/TypeScript and Python projects with automatic language detection, project-managed Ruff, and autofix support.

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

#### Python Only with uv

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
- **Python**: Enabled when Python source files (`*.py` or `*.pyi`), explicit Ruff configuration (`ruff.toml`, `.ruff.toml`, or `[tool.ruff]`), or `uv` project files (`uv.lock`, `[tool.uv]`) are present.
- **Neither**: Succeeds with an informational message if neither language is detected.

### JavaScript and TypeScript Behavior

When `package.json` is present, the action resolves the JS runtime and package manager and executes matching scripts defined in `package.json`:

1. `check`
2. `format` and `lint`
3. `fmt` and `lint`
4. Individual `format`, `fmt`, or `lint` scripts

### Python and Ruff Behavior

Python projects must declare Ruff in their development dependencies:

- **uv Projects**: When `uv.lock` or `[tool.uv]` is detected, `astral-sh/setup-uv` sets up `uv` and runs Ruff via `uv run --locked ruff`. The lockfile `uv.lock` is preserved and never modified during execution.
- **Non-uv Projects**: Pre-existing `ruff` executables in the environment are preserved and executed directly. Standalone `pip install ruff` is never run as a fallback.
- **Dependency Requirement**: If Python is detected but Ruff is not installed or declared in project development dependencies, the action fails fast with an actionable diagnostic message (e.g. instructing to run `uv add --dev ruff`).

## Autofix vs Check-Only Behavior

- **Autofix Mode**: When running under a workflow named `autofix.ci`, Ruff executes `uv run --locked ruff check --fix .` followed by `uv run --locked ruff format .` (or `ruff check --fix .` and `ruff format .` for non-uv projects).
- **Check-Only Mode**: For standard CI runs, Ruff executes `uv run --locked ruff check .` followed by `uv run --locked ruff format --check .` (or `ruff check .` and `ruff format --check .` for non-uv projects) without modifying source files.

## Compatibility

See the repository **[Compatibility Contract & Release Policy](../COMPATIBILITY.md)** for supported toolchain versions, package managers, and matrix coverage.

## Inputs

| Name      | Description                                                   | Default | Required |
| --------- | ------------------------------------------------------------- | ------- | -------- |
| `runtime` | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |

## Outputs

| Name                      | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `node-version`            | The Node.js version used                                 |
| `bun-version`             | The Bun version used                                     |
| `package-manager`         | The package manager used                                 |
| `package-manager-version` | The version of the package manager used                  |
| `runtime`                 | The runtime used (node or bun)                           |
| `has-js`                  | Whether JavaScript/TypeScript was detected               |
| `has-python`              | Whether Python was detected                              |
| `has-uv`                  | Whether uv was detected for Python dependency management |
| `python-version`          | The Python version used                                  |

## Detection Limitations & Monorepo Behavior

- Python source file scanning traverses root and subdirectories while skipping standard excluded paths (`node_modules`, `.venv`, `venv`, `.git`, `dist`, `build`, `.tox`, `__pycache__`, etc.).
- Repositories containing configuration files without active Python source files or `uv`/Ruff declarations bypass Python toolchain setup.
