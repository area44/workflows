# area44/pages

Build and upload GitHub Pages static site.

## Action Purpose

The `pages` composite action automates static site builds and artifact generation for GitHub Pages deployments.

## Features and Supported Behavior

- **Automatic Environment Resolution:** Automatically detects project package manager (`npm`, `pnpm`, `bun`) and runtime (`node`, `bun`).
- **Flexible Runtimes:** Supports Node.js and Bun project runtimes with automatic detection from project configuration (`.bun-version`, `.nvmrc`, `.node-version`, `packageManager`, and `devEngines`).
- **Automatic Vite+ Detection:** Automatically detects Vite+ project configuration and executes `vp build` (or falls back to `vpr build` if `vp` is unavailable).
- **Custom Build Commands:** Supports custom build commands via `build-command` input.
- **Site Environment Export:** Automatically exports `SITE` (`https://<owner>.github.io`), `BASE`, and `BASE_URL` (`/` for primary user/org site, `/<repo>/` for project sites) environment variables for build steps.
- **Build Output Validation:** Validates that the configured build output directory (`path`) exists and contains built files before uploading the pages artifact.

## Usage Example

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

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Build and Upload Artifact
        uses: area44/workflows/pages@main
        with:
          # Optional: path: 'dist'
          # Optional: build-command: 'npm run build'
```

## Public API Contract

### Inputs

| Name            | Description                               | Default                       | Required |
| --------------- | ----------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located | `dist`                        | Optional |
| `build-command` | Custom build command                      | `<package-manager> run build` | Optional |

### Outputs

| Name                         | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `javascript-detected`        | Whether a JavaScript project (`package.json`) was detected |
| `javascript-runtime`         | The resolved JavaScript runtime (`node` or `bun`)          |
| `javascript-package-manager` | The package manager used (`npm`, `pnpm`, or `bun`)         |
| `javascript-toolchain`       | The resolved toolchain (`vite-plus` or empty string)       |
| `vp-version`                 | The version of Vite+ installed                             |

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Environment Resolution Algorithm Guide](../docs/environment-resolution.md)**: Design principles, decision flow, conflict handling, and setup planning details.
- **[Error Handling Architecture](../docs/errors.md)**: Native JavaScript error boundaries, top-level error handling, and error logging.
- **[Security Boundaries](../docs/security.md)**: Input sanitization, argument tokenization, and command execution boundaries.
- **[Maintenance & Repository Health](../docs/maintenance.md)**: Maintenance workflows, build scripts, and quality gates.
- **[Integration Testing Guide](../docs/integration-testing.md)**: Module integration testing, fixture generators, and CI test harnesses.
