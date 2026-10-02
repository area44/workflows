# area44/lint-format

Run linting and formatting scripts.

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

## Compatibility

See the repository **[Compatibility Contract & Release Policy](../COMPATIBILITY.md)** for supported toolchain versions, package managers, and matrix coverage.

## Inputs

| Name      | Description                                                        | Default         |
| --------- | ------------------------------------------------------------------ | --------------- |
| `runtime` | Optional runtime and version override (e.g., `node@24`, `bun@1.4`) | (auto-detected) |

## Outputs

| Name                      | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `node-version`            | The Node.js version used                       |
| `bun-version`             | The Bun version used                           |
| `package-manager`         | The package manager used                       |
| `package-manager-version` | The version string of the package manager used |
| `runtime`                 | The resolved runtime mode (`node` or `bun`)    |
