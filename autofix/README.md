# area44/autofix.ci

Run linting/formatting scripts and push fixes using autofix.ci.

## Usage

```yaml
name: autofix.ci
on:
  pull_request:
jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: area44/workflows/autofix@main
```

## Inputs

| Name | Description | Default |
|------|-------------|---------|
| `node-version` | Optional Node.js version override | (auto-detected) |
