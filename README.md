# area44/workflows

This repository contains reusable **GitHub Actions workflows** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects by defining shared automation steps—such as linting, fixing, building, testing, and deploying—in one central location.

## How to Use

To use one of these reusable workflows in your own repository, reference it like this:

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

## License

This project is licensed under the [MIT License](LICENSE).
