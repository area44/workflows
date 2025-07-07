# Actions – Reusable GitHub Actions by AREA44

Welcome to the **Actions**, a centralized repository of **reusable GitHub Actions workflows** maintained by **AREA44**. This repository helps standardize and streamline CI/CD processes across multiple projects.

## 🚀 What Is This?

GitHub’s **reusable workflows** feature allows you to define shared automation logic (such as building, testing, linting, fixing, and deploying) once—and then reuse it across any repository with the `uses:` keyword.

This repository serves as the **central source of truth** for all shared workflows within the AREA44 ecosystem.

## 📦 Available Workflows

* **`astro.yml`** — Build and deploy Astro sites to GitHub Pages.
* **`autofix.yml`** — Automatically fix code style issues using formatters and linters.
* **`vite.yml`** — Build and deploy Vite sites to GitHub Pages.

> Workflows are stored in the `actions` directory.

## 🛠️ How to Use

In your downstream repository, reference a workflow like this:

```yaml
name: autofix.ci

on:
  push:
    branches: ['main']
  pull_request:

jobs:
  autofix:
    uses: area44/actions/.github/workflows/autofix.yml@main
```

> Replace `main` with a version tag (e.g., `v0.4.1`) for stability in production use.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
