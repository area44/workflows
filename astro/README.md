# area44/astro

Easily build and deploy your Astro site to GitHub Pages.

## Features

- **Auto-detection**: Automatically detects your Node.js version (from `.nvmrc` or `package.json`) and package manager (npm, pnpm, yarn, bun).
- **Standardized Setup**: Handles dependencies installation, site build, and artifact upload for GitHub Pages.
- **Node.js version override**: Allows manually specifying the Node.js version.

## Usage

Add a workflow to your repository (`.github/workflows/pages.yml`):

```yaml
name: GitHub Pages

on:
  push:
    branches: ['main']
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

      - name: Build Astro site
        uses: area44/workflows/astro@main
        with:
          # Optional: Specify the directory where the built site is located. Default: 'dist'.
          # path: 'dist'
          # Optional: Override the auto-detected Node.js version (e.g., '24', 'lts/*').
          # node-version: '24'
          # Optional: Override the default build command ('npm run build').
          # build-command: 'npm run build'
```

## Inputs

| Name | Description | Default |
|------|-------------|---------|
| `path` | The directory where the built site is located | `dist` |
| `node-version` | Optional Node.js version override | (auto-detected) |
| `build-command` | Optional build command override | `npm run build` |

## Outputs

| Name | Description |
|------|-------------|
| `node-version` | The Node.js version used |
| `package-manager` | The package manager used |
