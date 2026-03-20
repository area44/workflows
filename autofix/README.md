# area44/autofix.ci

Standardize your linting and formatting process and integrate with autofix.ci.

## Features

- **Smart Script Detection**: Automatically detects and runs `check`, `format`, or `lint` scripts if present in `package.json`.
- **Integrated Support**: Seamlessly works with autofix-ci/action to push fixes to your repository.
- **Environment Aware**: Detects and uses the correct package manager for script execution.

## Usage

Add a workflow to your repository (`.github/workflows/autofix.ci.yml`):

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
      
      - name: Run autofix scripts
        uses: area44/workflows/autofix@main
        with:
          # Optional: Override the auto-detected Node.js version.
          # node-version: '24'
```

## Script Priority

The action tries to run scripts in the following priority:
1. `check`
2. `format` AND `lint`
3. `fmt` AND `lint`
4. `lint`
5. `format`
6. `fmt`

## Inputs

| Name | Description | Default |
|------|-------------|---------|
| `node-version` | Optional Node.js version override | (auto-detected) |
