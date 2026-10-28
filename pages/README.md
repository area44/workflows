# area44/pages

Build and deploy static sites to GitHub Pages.

## Action Purpose

The `pages` composite action builds and deploys static sites to GitHub Pages across the AREA44 ecosystem. It resolves project runtimes and package managers, installs dependencies, executes site build commands, validates output directories, and uploads site artifacts.

## Features and Supported Behavior

- **Unified Build Pipeline:** Automated environment resolution, dependency synchronization, site compilation, output directory validation, and Pages artifact upload.
- **Automatic Vite+ Detection:** Detects Vite+ projects from dependencies in `package.json` and uses `voidzero-dev/setup-vp` for setup and dependency installation.
- **Flexible Runtimes:** Supports Node.js and Bun project runtimes with automatic detection from project configuration (`.bun-version`, `.nvmrc`, `.node-version`, `packageManager`, and `devEngines`).
- **Automatic Site and Base Variables:** Derives and exports `SITE`, `BASE`, and `BASE_URL` environment variables from GitHub repository context (`https://<owner>.github.io` and `/<repo>/`).
- **Output Validation:** Asserts that the configured build output directory exists and is non-empty before initiating GitHub Pages artifact upload.

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
          # Optional: build-command: 'npm run build'
```

## Inputs

| Name            | Description                                                                                   | Default                       | Required |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located (empty or whitespace-only values default to `dist`) | `dist`                        | Optional |
| `build-command` | Custom build command                                                                          | `<package-manager> run build` | Optional |

## Project Runtime Resolution

Project environment resolution distinguishes between three independent concepts:

- **Project Runtime:** The JavaScript execution environment (`node` or `bun`).
- **Runtime Version:** The version of Node.js or Bun to provision (e.g. `24` or `1.4.0`).
- **Package Manager:** The package manager binary used for dependency installation (`npm`, `pnpm`, or `bun`).

### Conflict Validation & Resolution Precedence

All project configuration signals are validated for contradictions before selecting a runtime. Contradictory runtime declarations (e.g. declaring both `devEngines.node` and `devEngines.bun` in `package.json`, or pairing `.bun-version` with `devEngines.node`) produce an explicit configuration error rather than silently choosing one runtime.

After conflict validation, runtime selection follows deterministic precedence:

1. **Bun Package Manager:** If `packageManager` or `devEngines.packageManager` is `bun@...`, or if `bun.lock` exists, Bun runtime is selected.
2. **`package.json` `devEngines`:** Declarations in `devEngines.bun` select Bun; `devEngines.node` select Node.js.
3. **Version Files:** A `.bun-version` file selects Bun runtime; an `.nvmrc` or `.node-version` file selects Node.js runtime.
4. **Default Fallback:** Defaults to Node.js runtime (`node@24`) when no explicit Bun runtime signals exist.

### Package Manager Compatibility

Bun runtime supports both `bun` and `pnpm` package managers. For example, a project using `pnpm` with Bun runtime is valid:

```json
{
  "packageManager": "pnpm@12.15.0",
  "devEngines": {
    "bun": "1.4.0"
  }
}
```

Pairing Bun runtime with `npm` package manager is unsupported and triggers an explicit validation failure.

## Exported Environment Variables

The action automatically resolves and exports the following environment variables for static site generators based on GitHub repository metadata:

| Name       | Resolved Value                                                      | Description                                                        |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `SITE`     | `https://<owner>.github.io`                                         | Deployment origin URL derived from `GITHUB_REPOSITORY_OWNER`.      |
| `BASE`     | `/` (primary `<owner>.github.io` repo) or `/<repo>/` (project repo) | Base path prefix for site assets derived from `GITHUB_REPOSITORY`. |
| `BASE_URL` | `/` (primary `<owner>.github.io` repo) or `/<repo>/` (project repo) | Equivalent alias to `BASE` for frameworks reading `BASE_URL`.      |

## Outputs

| Name                                 | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `javascript-runtime`                 | The JavaScript runtime used (node or bun)             |
| `javascript-runtime-version`         | The version of the resolved JavaScript runtime        |
| `javascript-package-manager`         | The JavaScript package manager used                   |
| `javascript-package-manager-version` | The version of the JavaScript package manager used    |
| `javascript-toolchain`               | The resolved JavaScript toolchain (vite or vite-plus) |
| `vp-version`                         | The version of Vite+ installed                        |

## Constraints and Failure Behavior

- **Static Output Requirement:** This action publishes static output artifacts for GitHub Pages. It does not convert server-rendered (SSR) applications into static sites. Ensure your framework project is configured for static site export (e.g., `output: 'static'` in Astro).
- **Build Execution Failure:** If the build command exits with a non-zero exit code, the action fails immediately. When `RUNNER_TEMP` is set, failure details are written to `${RUNNER_TEMP}/pages_build_error.log`.
- **Missing Output Directory Failure:** If the configured output directory (`path`) does not exist or contains no files after build execution, validation fails and prevents artifact upload. Diagnostic details are written to `${RUNNER_TEMP}/pages_build_error.log`.

## Related Documentation

- **[Repository README](../README.md)**: Main project overview and action API summary.
- **[Error Handling Architecture](../docs/errors.md)**: Detailed error boundaries and diagnostic error reporting.
- **[Security Boundaries](../docs/security.md)**: Input trust model and command tokenization.
- **[Maintenance & Repository Health](../docs/maintenance.md)**: Source files, build pipeline, and quality gates.
- **[Integration Testing Guide](../docs/integration-testing.md)**: Test scenarios and composite action matrix verification.
