# Workflow Hub - GitHub Actions for AREA44

This repository contains **reusable GitHub Actions workflows** maintained by AREA44. These workflows are designed to be shared and invoked across multiple repositories to standardize and simplify CI/CD pipelines.

## What Is This?

GitHub reusable workflows allow you to centralize common automation tasks (like testing, linting, formatting, and deployment) into a single source — then reuse them across all your projects using the `uses:` syntax.

This repository acts as the **central hub** for all shared workflows at AREA44.

## 📦 Available Workflows

- `autofix.yml`

## Usage Example

In a downstream repository:

```yaml
jobs:
  autofix:
    uses: area44/workflow-hub/.github/workflows/autofix.yml@v0.1.0
```

Make sure to tag versions in this repo and reference specific versions (like `@v0.1.0`) in consumers for stability.

## 📄 License

This repository is licensed under the [MIT License](LICENSE).
