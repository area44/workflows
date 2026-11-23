# area44/workflows

Reusable **GitHub Actions composite actions** for the AREA44 ecosystem: static-site deployment to GitHub Pages and automated code formatting/fixing.

## Actions

| Action                         | Reference                       | Purpose                                           |
| ------------------------------ | ------------------------------- | ------------------------------------------------- |
| [pages](./pages/README.md)     | `area44/workflows/pages@main`   | Build a static site and upload the Pages artifact |
| [autofix](./autofix/README.md) | `area44/workflows/autofix@main` | Format and fix JavaScript/TypeScript and Python   |

Each action's `action.yml` is the source of truth for its public inputs and outputs. The per-action READMEs document purpose, behavior, and usage.

## Usage

### Pages

```yaml
name: GitHub Pages

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: area44/workflows/pages@main

  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    permissions:
      pages: write
      id-token: write
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

### Autofix

```yaml
name: autofix.ci

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: read

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: area44/workflows/autofix@main
```

## Development

Requires Node.js (this repo builds with Vite+ / `vp`).

```bash
npm ci            # install locked dependencies
npm run build     # bundle src/ -> dist/ (vp pack)
npm test          # run unit + integration tests (vp test)
npm run lint      # lint (vp lint)
npm run format -- --check   # formatting check (vp fmt --check)
```

The committed `dist/` must match `src/`. `check-dist` in `.github/workflows/ci.yml` fails the build if `npm run build` produces any diff under `dist/`, so run `npm run build` and commit the result whenever you change `src/`.

## Documentation

- [pages/README.md](./pages/README.md) — pages action behavior and API.
- [autofix/README.md](./autofix/README.md) — autofix architecture and behavior.
- [docs/environment-resolution.md](./docs/environment-resolution.md) — how runtimes, package managers, and toolchains are detected.
- [docs/maintenance.md](./docs/maintenance.md) — sources of truth, build pipeline, quality gates, release process.
- [docs/integration-testing.md](./docs/integration-testing.md) — scenario factory, test layers, CI matrix.
- [docs/errors.md](./docs/errors.md) — error handling and failure reporting.
- [docs/security.md](./docs/security.md) — trust boundaries and command execution safety.
- [AGENTS.md](./AGENTS.md) — repository-level instructions for coding agents.

## License

[MIT](./LICENSE).
