# area44/astro

Add the following workflow to your repository:

```yaml
name: GitHub Pages

on:
  push:
    branches: ['main']
  pull_request:

permissions:
  contents: write

jobs:
  astro:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Run build
        uses: area44/workflows/astro@main
```

> Replace `main` with a specific version tag (e.g., `v2.0.0`) to ensure consistent behavior over time.
