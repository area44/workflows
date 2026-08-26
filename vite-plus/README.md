# area44/vite-plus

Build and deploy your Vite+ site to GitHub Pages with ease.

## Usage

Add the following workflow to your repository:

```yaml
name: GitHub Pages

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build Vite+ site
        uses: area44/workflows/vite-plus@main
        with:
          # Optional: runtime: 'node@24'
          # Optional: path: 'dist'
```

## Inputs

| Name            | Description                                   | Default         |
| --------------- | --------------------------------------------- | --------------- |
| `path`          | The directory where the built site is located | `dist`          |
| `runtime`       | Optional runtime and version override         | (auto-detected) |
| `build-command` | Custom build command                          |                 |

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `bun-version`             | The Bun version used                    |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `runtime`                 | The runtime used                        |
| `vp-version`              | The version of Vite+ used               |
