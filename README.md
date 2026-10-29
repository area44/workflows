# area44/workflows

This repository provides reusable **GitHub Actions workflows and composite actions** for the AREA44 ecosystem. It standardizes CI/CD processes, static site deployment, and automated code maintenance across projects.

## Available Actions

- **[Pages](./pages/README.md)** (`area44/workflows/pages@main`): Build and deploy static sites to GitHub Pages.
- **[Autofix](./autofix/README.md)** (`area44/workflows/autofix@main`): Automatically format and fix code.

## Quick Start

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

      - name: Build site
        uses: area44/workflows/pages@main
        with:
          # Optional: path: 'dist'
          # Optional: build-command: 'npm run build'
```

## Public Action API Summary

Each action's `action.yml` serves as the single source of truth for its public API contract.

### `pages` (GitHub Pages Build and Upload)

#### Inputs

| Name            | Description                               | Default                       | Required |
| --------------- | ----------------------------------------- | ----------------------------- | -------- |
| `path`          | Directory where the built site is located | `dist`                        | Optional |
| `build-command` | Custom build command                      | `<package-manager> run build` | Optional |

#### Outputs

| Name                                 | Description                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `javascript-detected`                | Whether a JavaScript project (`package.json`) was detected |
| `javascript-runtime`                 | The resolved JavaScript runtime (`node` or `bun`)          |
| `javascript-runtime-version`         | The version of Node.js or Bun used                         |
| `javascript-package-manager`         | The package manager used (`npm`, `pnpm`, or `bun`)         |
| `javascript-package-manager-version` | The version of the package manager used                    |
| `javascript-toolchain`               | The resolved toolchain (`vite` or `vite-plus`)             |
| `vp-version`                         | The version of Vite+ installed                             |

### `autofix` (Automatically format and fix code)

#### Inputs

This action accepts no inputs.

#### Outputs

| Name                                 | Description                                                           |
| ------------------------------------ | --------------------------------------------------------------------- |
| `javascript-detected`                | Whether a JavaScript project (`package.json`) was detected            |
| `javascript-runtime`                 | The resolved JavaScript runtime (`node` or `bun`)                     |
| `javascript-runtime-version`         | The version of Node.js or Bun used                                    |
| `javascript-package-manager`         | The package manager used (`npm`, `pnpm`, or `bun`)                    |
| `javascript-package-manager-version` | The version of the package manager used                               |
| `python-detected`                    | Whether Python source code (`.py`/`.pyi`) was detected                |
| `python-version`                     | The Python version used                                               |
| `python-package-manager`             | The Python package manager detected (`uv` or `pip`)                   |
| `ruff-version`                       | The Ruff version specified by the project or empty string for default |

## Documentation Index

- **[Pages Action Documentation](./pages/README.md)**: Details on inputs, outputs, environment variables (`SITE`, `BASE`, `BASE_URL`), and static site requirements.
- **[Autofix Action Documentation](./autofix/README.md)**: Information on JavaScript script selection, Python Ruff formatting/linting, and autofix.ci integration.
- **[Error Handling Architecture](./docs/errors.md)**: Native JavaScript error propagation, top-level boundaries, and build failure logging.
- **[Security Boundaries](./docs/security.md)**: Trust boundaries, shell command argument tokenization without subshell execution, and secret masking.
- **[Maintenance & Repository Health](./docs/maintenance.md)**: Invariants, sources of truth, build pipelines (`npm run build`), quality gates, and release versioning.
- **[Integration Testing & Scenario Factory Guide](./docs/integration-testing.md)**: Dynamic scenario factory architecture, unit tests, module-level tests, and composite action CI matrix verification.

## Development and Testing

Local testing and validation commands are managed via Vite+ (`vp`):

```bash
# Run unit and integration tests
npm test

# Run code style linting
npm run lint

# Check formatting
npm run format --check

# Build bundle artifacts in dist/
npm run build
```

For comprehensive details on repository structure and release management, see [docs/maintenance.md](./docs/maintenance.md) and [docs/integration-testing.md](./docs/integration-testing.md).

## License

This project is licensed under the [MIT License](LICENSE).
