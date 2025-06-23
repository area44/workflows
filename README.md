# Workflow Hub – Reusable GitHub Actions by AREA44

Welcome to the **Workflow Hub**, a centralized repository of **reusable GitHub Actions workflows** maintained by **AREA44**. This repository helps standardize and streamline CI/CD processes across multiple projects.

## 🚀 What Is This?

GitHub’s **reusable workflows** feature allows you to define shared automation logic (such as building, testing, linting, fixing, and deploying) once—and then reuse it across any repository with the `uses:` keyword.

This repository serves as the **central source of truth** for all shared workflows within the AREA44 ecosystem.

## 📦 Available Workflows

* **`astro.yml`** — Build and deploy Astro sites to GitHub Pages.
* **`autofix.yml`** — Automatically fix code style issues using formatters and linters.

> Additional workflows may be added over time to support common development and deployment needs.

## 🛠️ How to Use

In your downstream repository, reference a workflow like this:

```yaml
name: autofix.ci

on:
  push:
    branches: ["main"]
  pull_request:

jobs:
  autofix:
    uses: area44/workflow-hub/.github/workflows/autofix.yml@v0.1.0
```

### ✅ Best Practices

* Always reference **tagged versions** (e.g. `@v0.1.0`) instead of a branch like `main` to ensure stability.
* Keep your workflows modular and focused on a single task for better reusability.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
