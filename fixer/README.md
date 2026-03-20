# area44/fixer.ci

Run linting/formatting scripts and push fixes using fixer.ci.

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
  fixer:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run fixer
        uses: area44/workflows/fixer@main
```

## Inputs

| Name           | Description                       | Default         |
| -------------- | --------------------------------- | --------------- |
| `node-version` | Optional Node.js version override | (auto-detected) |
