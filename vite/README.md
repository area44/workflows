# area44/vite

> **Deprecated:** This action is deprecated in favor of [`area44/workflows/pages`](../pages/README.md).

Build and deploy your Vite or Vite+ site to GitHub Pages with ease.

## Usage

Recommended migration:

```yaml
- name: Build Vite site
  uses: area44/workflows/pages@main
  with:
    path: "dist"
```

## Inputs

| Name            | Description                                                   | Default | Required |
| --------------- | ------------------------------------------------------------- | ------- | -------- |
| `path`          | Directory where the built site is located                     | `dist`  | Optional |
| `runtime`       | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |
| `toolchain`     | Deprecated input (Vite+ is automatically detected)            | `auto`  | Optional |
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
