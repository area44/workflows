# area44/lint-format

Run linting/formatting scripts and push fixes using autofix.ci.

## Usage

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
