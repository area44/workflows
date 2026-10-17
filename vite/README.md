# area44/vite

Build and deploy your Vite or Vite+ site to GitHub Pages with ease.

## Features

- **Automatic Toolchain Detection:** Automatically detects whether the target project uses standard Vite or Vite+ (by inspecting `package.json` dependencies, devDependencies, optionalDependencies, and catalog declarations).
- **Explicit Toolchain Override:** Optionally specify `toolchain: "vite"` or `toolchain: "vite-plus"` to override automatic detection.
- **Vite+ Setup & Fallback:** When Vite+ is detected, uses `voidzero-dev/setup-vp` to set up Vite+ and run dependency installation once. Prefers `vp build` for Vite+ builds, automatically falling back to `vpr build` if the `vp` executable is unavailable in `PATH`.
- **Custom Build Command:** Easily override the build command using `build-command`.

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
        uses: actions/checkout@v4

      - name: Build Vite site
        uses: area44/workflows/vite@main
        with:
          # Optional: runtime: 'node@24'
          # Optional: toolchain: 'auto' (or 'vite', 'vite-plus')
          # Optional: path: 'dist'
```

## Compatibility

See the repository **[Compatibility Contract & Release Policy](../COMPATIBILITY.md)** for supported toolchain versions, package managers, and matrix coverage.

## Inputs

| Name            | Description                                                   | Default | Required |
| --------------- | ------------------------------------------------------------- | ------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`  | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |
| `toolchain`     | Optional toolchain selection (auto, vite, or vite-plus)       | `auto`  | Optional |
| `build-command` | Custom build command                                          |         | Optional |

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
