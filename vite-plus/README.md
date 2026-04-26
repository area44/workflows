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
          # Optional: node-version: '24'
          # Optional: path: 'dist'
```

## Inputs

| Name            | Description                                   | Default         |
| --------------- | --------------------------------------------- | --------------- |
| `path`          | The directory where the built site is located | `dist`          |
| `node-version`  | Optional Node.js version override             | (auto-detected) |
| `build-command` | Optional build command override               |                 |

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `version`                 | The version of Vite+ used               |
