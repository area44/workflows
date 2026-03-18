# area44/autofix.ci

Run linting/formatting scripts and push fixes using autofix.ci.

## Usage

```yaml
name: autofix.ci
on:
  push:
    branches: ['main']
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

| Name | Description | Default |
|------|-------------|---------|
| `node-version` | Optional Node.js version override | (auto-detected) |
