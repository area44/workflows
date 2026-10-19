# area44/pages

Build static sites and upload GitHub Pages artifacts with automatic JavaScript environment setup and Vite+ toolchain detection.

## Features

- **Unified Build Pipeline:** Standardized environment resolution, dependency installation, build execution, output validation, and Pages artifact upload for static site generators.
- **Automatic Vite+ Detection:** Automatically detects Vite+ projects from `package.json` dependencies and uses `voidzero-dev/setup-vp` for setup and dependency installation.
- **Output Validation:** Ensures the configured build output directory exists and is non-empty before uploading the GitHub Pages artifact.
- **Flexible Runtimes:** Supports Node.js and Bun runtimes with automatic version detection or explicit overrides.
- **Site and Base Variable Resolution:** Automatically exports `SITE`, `BASE`, and `BASE_URL` environment variables derived from repository metadata (`https://<owner>.github.io` and `/<repo>/`), with support for custom `SITE`, `BASE`, and `BASE_URL` environment overrides.

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

| Name       | Description                                                                                                                                                  | Default                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `SITE`     | The origin URL for the GitHub Pages deployment (e.g. `https://owner.github.io`). Must be an origin URL without path components, query strings, or fragments. | Derived from `GITHUB_REPOSITORY_OWNER` or explicit `SITE`. |
| `BASE`     | Path prefix for site assets (e.g. `/my-repo/` or `/`). Normalized with leading/trailing slashes.                                                             | Derived from `GITHUB_REPOSITORY` or explicit `BASE`.       |
| `BASE_URL` | Equivalent alias to `BASE`. Normalized with leading/trailing slashes.                                                                                        | Equivalent to `BASE`.                                      |

### Base Path Normalization & Precedence Rules

- **Equivalence:** `BASE` and `BASE_URL` serve identical purposes for path prefix resolution.
- **Normalization:** Path prefixes are normalized with leading and trailing slashes (e.g., `my-app` -> `/my-app/`, `///docs///` -> `/docs/`).
- **Validation:** Absolute URLs (e.g., `https://example.com`), query parameters (`?param`), fragments (`#hash`), and control characters are rejected.
- **Precedence & Conflicts:** If both `BASE` and `BASE_URL` are provided:
  - If both specify matching normalized paths (e.g. `BASE="my-app"` and `BASE_URL="/my-app/"`), the normalized value is used.
  - If both are provided with conflicting values (e.g. `BASE="docs"` and `BASE_URL="app"`), the action fails with an explicit error message.
- **Defaults:** Root deployments (`<owner>.github.io`) default to `/`. Project repositories default to `/<repo>/`.

#### Examples

- **Root Deployment (`/`):**
  - Configured repository: `owner/owner.github.io`
  - Output: `SITE=https://owner.github.io`, `BASE=/`, `BASE_URL=/`
- **Subpath Deployment (`/docs/`):**
  - Configured repository: `owner/my-repo` with `BASE=docs`
  - Output: `SITE=https://owner.github.io`, `BASE=/docs/`, `BASE_URL=/docs/`
- **Invalid Configuration:**
  - `BASE="https://example.com"` -> Fails validation (`absolute URLs are not supported`).
  - `SITE="https://owner.github.io?foo=bar"` -> Fails validation (`query strings and fragments are not supported`).
  - `SITE="https://owner.github.io/subpath"` -> Fails validation (`path components are not supported for SITE origin`).

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
