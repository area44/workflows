# area44/images

Optimize images (SVGs, PNGs, JPEGs).

## Usage

```yaml
name: optimize-images

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: write

jobs:
  images:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Optimize images
        uses: area44/workflows/images@main
        with:
          autofix-bot: "autofix-ci" # optional, defaults to 'autofix-ci'
```

## Inputs

| Name           | Description                                                   | Default         |
| -------------- | ------------------------------------------------------------- | --------------- |
| `node-version` | Optional Node.js version override                             | (auto-detected) |
| `autofix-bot`  | The bot to use for autofix ('autofix-ci' or 'github-actions') | `autofix-ci`    |
