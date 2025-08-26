# area44/autofix

Add the following workflow to your repository:

```yaml
name: autofix.ci

on:
  push:
    branches: ['main']
  pull_request:

permissions:
  contents: write

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Run autofix
        uses: area44/workflows/autofix@main
```

> Replace `main` with a specific version tag (e.g., `v2.0.0`) to ensure consistent behavior over time.
