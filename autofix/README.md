# area44/autofix

Automatically lints and formats code using project-defined scripts and integrates with [autofix.ci](https://autofix.ci/).

## Features

- Auto-detection of Node.js, Bun, and Python project configurations and package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`).
- Automatic dependency installation and lockfile synchronization whenever a supported JavaScript or Python project is detected.
- Automatic execution of project linting and formatting scripts (`check`, `format`, `fmt`, `lint`).
- Python code formatting and linting powered by Ruff when Python source files exist.
- Seamless integration with [autofix.ci](https://autofix.ci/) for automated pull request fixes.

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
