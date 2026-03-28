# area44/images

This composite action optimizes images (SVGs, PNGs, JPEGs, and GIFs).

## Usage

Create a workflow file (e.g., `.github/workflows/images.yml`) in your repository:

```yaml
name: images.ci

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
```

## Inputs

| Input          | Description                                              | Required | Default                                  |
| -------------- | -------------------------------------------------------- | -------- | ---------------------------------------- |
| `node-version` | Optional Node.js version override (e.g., '24', 'lts/\*') | No       | Detected from `.nvmrc` or `package.json` |

## Tools Used

- **SVGO**: For SVG optimization.
- **OptiPNG**: For PNG optimization.
- **Jpegoptim**: For JPEG optimization.
- **Gifsicle**: For GIF optimization.
- **autofix.ci**: For automatically committing the optimized images.
