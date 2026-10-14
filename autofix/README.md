# area44/autofix

Runs linting and formatting scripts in your workspace and integrates with [autofix.ci](https://autofix.ci/).

## Usage

```yaml
name: autofix.ci

on:
  pull_request:
  push:
    branches: ["main"]

permissions:
  contents: read

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run autofix
        uses: area44/workflows/autofix@main
```

## Public API Contract

### Inputs

| Name      | Description                                                   | Default | Required |
| --------- | ------------------------------------------------------------- | ------- | -------- |
| `runtime` | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |

### Outputs

| Name                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `node-version`            | The Node.js version used                                              |
| `bun-version`             | The Bun version used                                                  |
| `package-manager`         | The package manager used                                              |
| `package-manager-version` | The version of the package manager used                               |
| `runtime`                 | The runtime used (node or bun)                                        |
| `has-python-source`       | Whether Python source code was detected                               |
| `python-version`          | The Python version used                                               |
| `python-package-manager`  | The Python package manager detected (uv or pip)                       |
| `ruff-version`            | The Ruff version specified by the project or empty string for default |

## Python Tooling Support

The Autofix action conditionally sets up Python environment tools and runs Ruff for linting and formatting alongside JavaScript/TypeScript tooling.

### Python Source Detection Rules

Python setup and Ruff execution are strictly gated on the presence of actual Python source files (`.py` or `.pyi`) in the workspace outside excluded directories (such as `.venv`, `node_modules`, `dist`, `build`, `.git`, etc.):

- **Source Code Prerequisite**: A repository must contain `.py` or `.pyi` source files to trigger Python setup, dependency installation, or Ruff execution.
- **Metadata and Configuration Only**: The presence of `pyproject.toml`, `[tool.ruff]`, `requirements.txt`, or other manifests without `.py` or `.pyi` files will not trigger Python setup or Ruff.
- **Mixed-Language Repositories**: Repositories containing both JavaScript/TypeScript and Python code continue running language-specific autofix steps and run Ruff when Python source files exist.

### Python Package Manager Detection

When Python source files are detected, supported dependency package managers are identified in deterministic priority:

- `uv`: Detected via `uv.lock` or `[tool.uv]` table in `pyproject.toml`.
- `pip`: Detected via `requirements.txt`, `setup.py`, `setup.cfg`, or standard `pyproject.toml`.

Supported package managers are `uv` and `pip`. If a required package manager binary is unavailable in PATH, the workflow fails fast with a clear error without attempting undocumented installation fallbacks.

### Single Ruff Execution Mechanism

All Python formatting and linting are handled exclusively by the pinned GitHub Action `astral-sh/ruff-action`:

- **Single Architecture**: No inline Ruff installations or custom runners (`uvx`, `pipx`, `python -m ruff`) are executed by the action scripts.
- **Ruff Operations**:
  - Code formatting: `ruff format .`
  - Code linting & autofix: `ruff check --fix .`
- **Ruff Version Resolution**:
  - Exact pins (`ruff==0.4.2`, `0.4.2`, `@0.4.2`) in `uv.lock`, `pyproject.toml` (excluding `[tool.ruff]` configuration blocks), or `requirements.txt` are passed to `astral-sh/ruff-action`.
  - Non-exact range constraints (`>=`, `^`, `~=`) return an empty string, allowing `astral-sh/ruff-action` to use its documented default version.

### Skip Environment Options

- `SKIP_PYTHON_INSTALL=true`: Skips project dependency installation when dependencies are already pre-installed, while continuing to run `ruff-action` when Python source files are present.
