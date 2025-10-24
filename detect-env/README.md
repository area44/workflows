# area44/detect-env

## Usage

Add the following workflow to your repository:

```yaml
name: Detect Environment

on:
  push:
    branches: ['main']
  pull_request:

permissions:
  contents: write

jobs:
  detect-env:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Detect Node.js and package manager
        id: detect_env
        uses: area44/workflows/detect-env@main
```

> Replace `main` with a specific version tag (e.g., `v2.0.0`) to ensure consistent behavior over time.

## Outputs

| Outputs                   | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `node_version`            | Detected Node.js version (e.g., `24.0.0`)        |   
| `package_manager`         | Detected package manager  (e.g., `pnpm`)         |
| `package_manager_version` | Detected package manager version (e.g, `10.0.0`) | 

Use `area44/detect-env` in another workflow to automatically set up the correct Node.js and package manager:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version: ${{ steps.detect_env.outputs.node_version }}

- name: Install dependencies
  run: |
    case "${{ steps.detect_env.outputs.package_manager }}" in
      pnpm) pnpm install ;;
      yarn) yarn install ;;
      bun)  bun install ;;
      *)    npm ci ;;
    esac
```
