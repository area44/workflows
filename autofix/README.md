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

The Autofix action automatically detects Python projects and runs Ruff for linting and formatting alongside JavaScript/TypeScript tooling.

### Python Package Manager Detection Priority

When multiple lockfiles or configuration files exist in a repository, the Python package manager is detected in the following deterministic order:

- `uv`: Detected via `uv.lock` or `[tool.uv]` table in `pyproject.toml`.
- `pip`: Detected via `requirements.txt`, `setup.py`, `setup.cfg`, or standard `pyproject.toml`.

### Python Dependency Installation and Ruff Execution

- **Dependency Installation**:
  - `uv`: Installs dependencies using `uv sync` (when `uv.lock` or `[tool.uv]` exists) or `uv pip install -r requirements.txt` (when `requirements.txt` exists).
  - `pip`: Installs dependencies using `pip install -r requirements.txt && pip install -e .` (when both `requirements.txt` and package metadata exist), `pip install -r requirements.txt` (for requirements-only projects), or `pip install -e .` (for editable package installations).
- **Ruff Version Resolution**:
  - Inspects `uv.lock` for locked Ruff package versions.
  - Inspects `pyproject.toml` (`dependencies`, `optional-dependencies`, `dependency-groups`) and `requirements.txt` for exact pins or version constraints.
  - Passes resolved version to `astral-sh/ruff-action` (`astral-sh/ruff-action@278981a28ce3188b1e39527901f38254bf3aac89`), or falls back to standard version resolution if no version is declared.
- **Ruff Formatting and Linting**:
  - Code formatting: `ruff format .`
  - Code linting & autofix: `ruff check --fix .`
  - Central configuration is defined in `pyproject.toml` under `[tool.ruff]`.
- **Ruff Declaration vs Availability**:
  - Distinguishes whether Ruff is declared as a project dependency vs executable in the target Python environment.
  - If Ruff is declared in dependencies (`pyproject.toml`, `requirements.txt`, `uv.lock`) but not yet installed, the workflow automatically provisions project dependencies before formatting or linting.
  - Setting `SKIP_PYTHON_INSTALL=true` bypasses project dependency installation step when dependencies are already pre-installed.
- **Failure Behavior and Troubleshooting**:
  - If a required Python package manager (`uv` or `pip`) is unavailable, dependency installation fails, or Ruff execution encounters unresolvable errors, the action logs actionable error details and fails fast with `WorkflowError`.
