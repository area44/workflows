# area44/lint-format

Run linting/formatting scripts.

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

## Inputs

| Name           | Description                       | Default         |
| -------------- | --------------------------------- | --------------- |
| `node-version` | Optional Node.js version override | (auto-detected) |

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
