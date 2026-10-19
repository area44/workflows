# area44/pages

Build static sites and upload GitHub Pages artifacts with automatic JavaScript environment setup and Vite+ toolchain detection.

## Features

- **Unified Build Pipeline:** Standardized environment resolution, dependency installation, build execution, output validation, and Pages artifact upload for static site generators.
- **Automatic Vite+ Detection:** Automatically detects Vite+ projects from `package.json` dependencies and uses `voidzero-dev/setup-vp` for setup and dependency installation.
- **Output Validation:** Ensures the configured build output directory exists and is non-empty before uploading the GitHub Pages artifact.
- **Flexible Runtimes:** Supports Node.js and Bun runtimes with automatic version detection or explicit overrides.
- **Site and Base Variable Resolution:** Automatically exports `SITE` and `BASE` environment variables derived from repository metadata (`https://<owner>.github.io` and `/<repo>/`), with support for custom `SITE` and `BASE` environment overrides.

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

| Name            | Description                                                   | Default                       | Required |
| --------------- | ------------------------------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`                        | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |                               | Optional |
| `build-command` | Custom build command                                          | `<package-manager> run build` | Optional |

## Environment Variables

| Name   | Description                                                                                                        | Default                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `SITE` | The base origin URL for the GitHub Pages deployment (e.g. `https://owner.github.io`). Validated as HTTP/HTTPS.     | Derived from `GITHUB_REPOSITORY_OWNER` or explicit `SITE`. |
| `BASE` | The path prefix for site assets (e.g. `/my-repo/` or `/`). Automatically normalized with leading/trailing slashes. | Derived from `GITHUB_REPOSITORY` or explicit `BASE`.       |

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
