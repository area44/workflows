# area44/autofix (Legacy)

> [!IMPORTANT]
> This action has been renamed to **area44/lint-format**. This folder is kept for backward compatibility, but it is recommended to update your workflows to use the new name.

Run linting/formatting scripts and push fixes using autofix.ci.

## Usage (Recommended)

Please refer to the [area44/lint-format](../lint-format/README.md) documentation.

```yaml
- name: Run lint and format
  uses: area44/workflows/lint-format@main
```

## Legacy Usage

```yaml
- name: Run autofix
  uses: area44/workflows/autofix@main
```

## Inputs

| Name           | Description                       | Default         |
| -------------- | --------------------------------- | --------------- |
| `node-version` | Optional Node.js version override | (auto-detected) |
