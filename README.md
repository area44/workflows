# area44/workflows

This repository provides reusable **GitHub Actions workflows and composite actions** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects.

## Composite Actions

- **[Astro](./astro/README.md)** (`area44/workflows/astro@main`): Build and deploy Astro sites to GitHub Pages.
- **[Vite](./vite/README.md)** (`area44/workflows/vite@main`): Build and deploy Vite sites to GitHub Pages.
- **[Vite+](./vite-plus/README.md)** (`area44/workflows/vite-plus@main`): Build and deploy Vite+ sites to GitHub Pages.
- **[Lint/Format](./lint-format/README.md)** (`area44/workflows/lint-format@main`): Run linting and formatting scripts.

## Quick Usage

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

      - name: Build Astro site
        uses: area44/workflows/astro@main
        with:
          # Optional: runtime: 'node@24'
          # Optional: path: 'dist'
```

## Public Action API Summary

Each action's `action.yml` serves as the single source of truth for its public API contract (inputs, outputs, defaults, required status), validated automatically via `npm run test:actions`.

### `astro` (Astro Site Build and Deploy)

#### Inputs

| Name            | Description                                                   | Default                       | Required |
| --------------- | ------------------------------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`                        | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |                               | Optional |
| `build-command` | Custom build command                                          | `<package-manager> run build` | Optional |

#### Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `bun-version`             | The Bun version used                    |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `runtime`                 | The runtime used (node or bun)          |

### `vite` (Vite Site Build and Deploy)

#### Inputs

| Name            | Description                                                   | Default                       | Required |
| --------------- | ------------------------------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`                        | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |                               | Optional |
| `build-command` | Custom build command                                          | `<package-manager> run build` | Optional |

#### Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `bun-version`             | The Bun version used                    |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `runtime`                 | The runtime used (node or bun)          |

### `vite-plus` (Vite+ Site Build and Deploy)

#### Inputs

| Name            | Description                                                   | Default     | Required |
| --------------- | ------------------------------------------------------------- | ----------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`      | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |             | Optional |
| `build-command` | Custom build command                                          | `vpr build` | Optional |

#### Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `bun-version`             | The Bun version used                    |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `runtime`                 | The runtime used (node or bun)          |
| `vp-version`              | The version of Vite+ installed          |

### `lint-format` (Lint and Format Verification)

#### Inputs

| Name      | Description                                                   | Default | Required |
| --------- | ------------------------------------------------------------- | ------- | -------- |
| `runtime` | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |

#### Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `bun-version`             | The Bun version used                    |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
| `runtime`                 | The runtime used (node or bun)          |

## Compatibility Overview

Environment resolution (`src/resolve-environment.ts`) automatically discovers workspace configuration or falls back to canonical default versions:

- **Supported Runtimes**: `node`, `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Canonical Default Versions**: Node.js 24, Bun 1.4, npm 12, pnpm 12
- **Supported Combinations**: Node+npm (default), Node+pnpm, Node+bun, Bun+bun, Bun+pnpm. (Bun+npm is explicitly unsupported).

For complete toolchain guarantees and combination matrices, see the **[Compatibility Contract & Release Policy](./COMPATIBILITY.md)** and **[Detailed Toolchain Matrix](./docs/compatibility.md)**.

## Documentation Architecture

Specialized documentation guides explain specific contracts and operational guarantees:

- **[Compatibility Contract](./COMPATIBILITY.md)** & **[Detailed Toolchain Matrix](./docs/compatibility.md)**: Toolchain baselines, compatibility matrix, and setup adapters.
- **[Versioning Model](./docs/versioning.md)**: Authoritative `package.json` version source, SemVer 2.0.0 rules, and change impact classification (`classifyChangeImpact`).
- **[Upgrade Guardrails](./docs/upgrade-guardrails.md)**: Baseline ref resolution chain, contract diffing, and SemVer impact enforcement.
- **[Error Contract](./docs/errors.md)**: Structured `WorkflowError` class and fail-fast `WorkflowErrorCode` values.
- **[Security Boundaries](./docs/security.md)**: Input trust model, command tokenization without subshell execution, and credential masking.
- **[Artifact Integrity](./docs/artifacts.md)**: Source to `dist/` build policy, entrypoint artifact verification, and synchronization enforcement.
- **[Maintenance & Repository Health](./docs/maintenance.md)**: Repository invariants, source of truth files, verification commands, and pre-merge checklist.

## License

This project is licensed under the [MIT License](LICENSE).
