# area44/fixer.ci

Run linting/formatting scripts and push fixes using fixer.ci.

## Usage

```yaml
name: fixer.ci
on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: write

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run autofix
        uses: area44/workflows/autofix@main
```

## Inputs

| Name           | Description                       | Default         |
| -------------- | --------------------------------- | --------------- |
| `node-version` | Optional Node.js version override | (auto-detected) |
