# area44/autofix

Automatically update code with [autofix.ci](https://autofix.ci/).

## Features

- **Auto-detection of project environments:** Automatically detects Node.js, Bun, and Python project configurations and package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`), running internal orchestration entrypoints under Node while executing project commands with resolved project tools.
- **Automatic dependency installation:** Synchronizes dependencies and lockfiles whenever a supported JavaScript or Python project configuration is detected.
- **JavaScript/TypeScript/Markdown project script execution:** Executes repository-configured scripts (`check`, `format`, `fmt`, `lint`) for JavaScript, TypeScript, Markdown, and other project-defined tooling.
- **Python linting and formatting with Ruff:** Automatically provisions Ruff once and runs `ruff check --fix .` and `ruff format .` sequentially in a single step whenever Python source files (`.py`/`.pyi`) are present in the repository.
- **Seamless autofix.ci integration:** Integrates cleanly with [autofix.ci](https://autofix.ci/) for automated pull request fixes.

## Usage

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
