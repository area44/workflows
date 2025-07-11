# area44/workflows

This repository contains reusable **GitHub Actions workflows** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects by defining shared automation steps—such as linting, fixing, building, testing, and deploying—in one central location.

## Available Workflows

| Workflow        | Description                                                                 |
|-----------------|-----------------------------------------------------------------------------|
| `astro.yml`     | Build and deploy [Astro](https://astro.build/) sites to GitHub Pages.       |
| `autofix.yml`   | Automatically fix code style issues using formatters and linters.           |
| `vite.yml`      | Build and deploy [Vite](https://vitejs.dev/) sites to GitHub Pages.         |

## 🛠️ How to Use

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
      - uses: area44/workflows/autofix@v2.0.0
```

> Replace `main` with a specific version tag (e.g., `v0.5.0`) to ensure consistent behavior over time.

## License

This project is licensed under the [MIT License](LICENSE).
