# area44/test

Run test scripts in your project.

## Usage

Add the following workflow to your repository:

```yaml
name: Test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run tests
        uses: area44/workflows/test@main
        with:
          # Optional: node-version: '24'
          # Optional: working-directory: 'packages/app'
```

## Inputs

| Name                | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `node-version`      | Optional Node.js version override          | (auto)  |
| `working-directory` | The directory where the project is located | `.`     |

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
