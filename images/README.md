# area44/images

This composite action optimizes images (SVGs, PNGs, JPEGs, and GIFs) and can optionally convert them to next-gen formats (WebP, AVIF).

## Usage

Create a workflow file (e.g., `.github/workflows/images.yml`) in your repository:

```yaml
name: images.ci # needed to securely identify the workflow

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: write

jobs:
  optimize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: area44/workflows/images@main
        with:
          convert-webp: true
          convert-avif: true
```

## Inputs

| Input          | Description                                              | Required | Default                                  |
| -------------- | -------------------------------------------------------- | -------- | ---------------------------------------- |
| `node-version` | Optional Node.js version override (e.g., '24', 'lts/\*') | No       | Detected from `.nvmrc` or `package.json` |
| `convert-webp` | Whether to convert PNG/JPEG images to WebP               | No       | `false`                                  |
| `convert-avif` | Whether to convert PNG/JPEG images to AVIF               | No       | `false`                                  |

## Tools Used

- **SVGO**: For SVG optimization.
- **OptiPNG**: For PNG optimization.
- **Jpegoptim**: For JPEG optimization.
- **Gifsicle**: For GIF optimization.
- **WebP (cwebp)**: For WebP conversion.
- **libavif (avifenc)**: For AVIF conversion.
- **autofix.ci**: For automatically committing the optimized and converted images.

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
