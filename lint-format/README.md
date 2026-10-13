# area44/lint-format (Deprecated)

> **Note**: `lint-format` has been renamed to `autofix`. Please update your workflows to use `area44/workflows/autofix@main`.

This action directory serves as a backward-compatibility wrapper that delegates execution to `autofix`.

## Usage (Deprecated)

```yaml
uses: area44/workflows/lint-format@main
```

## Migration

Please update your workflow step to use `autofix`:

```yaml
uses: area44/workflows/autofix@main
```
