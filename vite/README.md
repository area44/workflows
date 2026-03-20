# area44/vite

Easily build and deploy your Vite site to GitHub Pages.

## Features

- **Auto-detection**: Automatically detects your Node.js version and package manager.
- **Optimized for GitHub Pages**: Sets the correct `BASE` environment variable for GitHub Pages deployment.
- **Flexible Configuration**: Supports custom build commands and output paths.

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

      - name: Build Vite site
        uses: area44/workflows/vite@main
        with:
          # Optional: path: 'dist'
          # Optional: node-version: '24'
          # Optional: build-command: 'npm run build'
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
