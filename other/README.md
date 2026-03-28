# area44/other

Run miscellaneous scripts (linting, formatting, etc.).

## Usage

```yaml
name: autofix.ci # needed to securely identify the workflow

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: write

jobs:
  other:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run scripts
        uses: area44/workflows/other@main
        with:
          autofix-bot: "autofix-ci" # optional, defaults to 'autofix-ci'
```

## Inputs

| Name           | Description                                                 | Default         |
| -------------- | ----------------------------------------------------------- | --------------- |
| `node-version` | Optional Node.js version override                           | (auto-detected) |
| `autofix-bot`  | The bot to use for autofix ('autofix-ci' or 'github-actions') | `autofix-ci`    |
