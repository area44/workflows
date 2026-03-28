# area44/lint-format

Run linting/formatting scripts and push fixes using autofix.ci.

## Usage

> [!WARNING]
> For security reasons, the workflow file in which this action is used must be named `autofix.yml` or `autofix.ci.yml`, and the workflow name must be `autofix.ci`.

Create a file at `.github/workflows/autofix.yml`:

```yaml
name: autofix.ci
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
