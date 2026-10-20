# area44/pages

Build static sites and upload GitHub Pages artifacts with automatic JavaScript environment setup and Vite+ toolchain detection.

## Features

- **Unified Build Pipeline:** Standardized environment resolution, dependency installation, build execution, output validation, and Pages artifact upload for static site generators.
- **Automatic Vite+ Detection:** Automatically detects Vite+ projects from `package.json` dependencies and uses `voidzero-dev/setup-vp` for setup and dependency installation.
- **Output Validation:** Ensures the configured build output directory exists and is non-empty before uploading the GitHub Pages artifact.
- **Flexible Runtimes:** Supports Node.js and Bun runtimes with automatic version detection or explicit overrides.
- **Automatic Site and Base Variables:** Automatically resolves and exports `SITE`, `BASE`, and `BASE_URL` environment variables from GitHub repository context (`https://<owner>.github.io` and `/<repo>/`) for static site generators.

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
        uses: actions/checkout@v7

      - name: Build Pages site
        uses: area44/workflows/pages@main
        with:
          # Optional: path: 'dist'
          # Optional: runtime: 'node@24'
          # Optional: build-command: 'npm run build'
```

## Inputs

| Name            | Description                                                                                   | Default                       | Required |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located (empty or whitespace-only values default to `dist`) | `dist`                        | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4)                                 |                               | Optional |
| `build-command` | Custom build command                                                                          | `<package-manager> run build` | Optional |

## Exported Environment Variables

The action automatically exports environment variables for static site generators based on GitHub repository context:

| Name       | Resolved Value                                                      | Description                                                            |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `SITE`     | `https://<owner>.github.io`                                         | The deployment origin URL derived from `GITHUB_REPOSITORY_OWNER`.      |
| `BASE`     | `/` (primary `<owner>.github.io` repo) or `/<repo>/` (project repo) | The base path prefix for site assets derived from `GITHUB_REPOSITORY`. |
| `BASE_URL` | `/` (primary `<owner>.github.io` repo) or `/<repo>/` (project repo) | Equivalent alias to `BASE` for frameworks that read `BASE_URL`.        |

## Outputs

| Name                      | Description                                |
| ------------------------- | ------------------------------------------ |
| `node-version`            | The Node.js version used                   |
| `bun-version`             | The Bun version used                       |
| `package-manager`         | The package manager used                   |
| `package-manager-version` | The version of the package manager used    |
| `runtime`                 | The runtime used (node or bun)             |
| `toolchain`               | The resolved toolchain (vite or vite-plus) |
| `vp-version`              | The version of Vite+ installed             |

## Static Site Requirement

This action publishes static output artifacts for GitHub Pages. It does not automatically convert server-rendered or SSR applications into static sites. Ensure your framework project is configured to generate static output (e.g., `output: 'static'` in Astro or static export mode in Next.js).
