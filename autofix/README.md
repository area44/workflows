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

| Name                      | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `node-version`            | The Node.js version used                        |
| `bun-version`             | The Bun version used                            |
| `package-manager`         | The package manager used                        |
| `package-manager-version` | The version of the package manager used         |
| `runtime`                 | The runtime used (node or bun)                  |
| `has-python-source`       | Whether Python source code was detected         |
| `python-version`          | The Python version used                         |
| `python-package-manager`  | The Python package manager detected (uv or pip) |

## Python Tooling Support

The Autofix action automatically detects Python projects and runs Ruff for linting and formatting alongside JavaScript/TypeScript tooling.

### Python Package Manager Detection Priority

When multiple lockfiles or configuration files exist in a repository, the Python package manager is detected in the following deterministic order:

- `uv`: Detected via `uv.lock` or `[tool.uv]` table in `pyproject.toml`.
- `pip`: Detected via `requirements.txt`, `setup.py`, `setup.cfg`, or standard `pyproject.toml`.

### Python Dependency Installation and Ruff Execution

- Dependencies are installed using the detected manager (`uv sync` or `pip install -r requirements.txt`).
- Ruff checks and formats Python code (`ruff format` and `ruff check --fix`).
- Central configuration is defined in `pyproject.toml` under `[tool.ruff]`.
