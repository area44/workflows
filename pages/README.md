# pages

Build a static site and upload the GitHub Pages artifact. Reference: `area44/workflows/pages@main`.

## Behavior

1. **Resolve environment** — detects the JavaScript runtime (`node`/`bun`) and package manager (`npm`/`pnpm`/`bun`), and whether Vite+ is in use. See [../docs/environment-resolution.md](../docs/environment-resolution.md).
2. **Provision toolchain** — sets up pnpm, bun, node, or Vite+ via their official setup actions as resolved; otherwise installs dependencies (`npm ci`/`npm install`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`).
3. **Export site variables** — `SITE` (`https://<owner>.github.io`), `BASE`, and `BASE_URL` (`/` for a primary `<owner>.github.io` repo, `/<repo>/` otherwise).
4. **Build** — runs the build command:
   - `build-command` input if set;
   - else `vp build` when Vite+ is detected (falls back to `vpr build` if `vp` is unavailable);
   - else `<package-manager> run build`.
5. **Validate & upload** — fails if the output directory (`path`) is missing, empty, or not a directory; otherwise uploads it with `actions/upload-pages-artifact`.

## Inputs

| Name            | Description                               | Default                                                             |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `path`          | Directory where the built site is located | `dist`                                                              |
| `build-command` | Custom build command                      | `vp build` if Vite+ is detected, else `<package-manager> run build` |

## Outputs

| Name                         | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `javascript-detected`        | Whether a JavaScript/TypeScript project was detected |
| `javascript-runtime`         | The resolved runtime (`node` or `bun`)               |
| `javascript-package-manager` | The package manager used (`npm`, `pnpm`, or `bun`)   |
| `javascript-toolchain`       | The resolved toolchain (`vite-plus` or empty string) |
| `vp-version`                 | The version of Vite+ installed                       |

The canonical input/output contract is [action.yml](./action.yml); this table is a convenience summary.

## Usage

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

Build failures are written to `${RUNNER_TEMP}/pages_build_error.log` for CI assertions. Error handling details: [../docs/errors.md](../docs/errors.md). Security boundaries: [../docs/security.md](../docs/security.md).
