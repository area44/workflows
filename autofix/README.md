# autofix

Format and fix JavaScript/TypeScript and Python code. Reference: `area44/workflows/autofix@main`.

## Behavior

1. **Resolve** — detects JavaScript and Python domains independently (a repo may have one, both, or neither). Emits `No JavaScript or Python environment detected.` and succeeds when neither is present.
2. **Provision** — sets up uv/Python/ruff for Python and node/bun/pnpm for JavaScript via official setup actions, based on what was detected.
3. **Execute** — plans and executes fix tasks per detected language, aggregates diagnostics, and fails the step if any task fails. Commands that run are logged as `Executing: <command>` with quoted arguments.

### JavaScript / TypeScript

- Installs dependencies with the resolved package manager unless a matching fix script is absent (then installation is skipped).
- Selects write-capable scripts from `package.json`: `fix` (or `check:fix`), `lint:fix`/`lint:write`, `format:fix`/`format:write`/`format`/`fmt`. Plain `lint`/`check`/`test` are never run as autofix tasks.
- Falls back to tool-native autofix (Vite+, Biome, Prettier, ESLint, Oxlint, Oxfmt) when no suitable scripts exist.

### Python

- Installs dependencies via `uv sync` or `uv pip install -r requirements.txt` / `pip install` as detected.
- Runs `ruff check --fix .` then `ruff format .` whenever `.py`/`.pyi` files are present.

### Architecture

The runner (`src/autofix/`) is layered: a registry of language providers (`javascript`, `python`), a planner (`planExecution`) that detects tools and dedupes tasks, providers that own setup/install/execution, and an execution engine that resolves executables declaratively (`passthrough`/`path`/`project-binary`) and logs each run. Add a new language by registering a `LanguageProvider` with adapters in `src/autofix/registry.ts` — the orchestrator and engine need no changes.

## Inputs

None.

## Outputs

| Name                         | Description                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| `javascript-detected`        | Whether a JavaScript/TypeScript project was detected        |
| `javascript-runtime`         | The resolved runtime (`node` or `bun`)                      |
| `javascript-package-manager` | The package manager used (`npm`, `pnpm`, or `bun`)          |
| `python-detected`            | Whether a Python project or Python source code was detected |
| `python-package-manager`     | The Python package manager detected (`uv` or `pip`)         |

The canonical output contract is [action.yml](./action.yml); this table is a convenience summary.

## Usage

```yaml
name: autofix.ci

on:
  push:
    branches: ["main"]
  pull_request:

permissions:
  contents: read

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: area44/workflows/autofix@main
```

When the workflow is named `autofix.ci`, the action also runs `autofix-ci/action` to commit fixes. Environment resolution details: [../docs/environment-resolution.md](../docs/environment-resolution.md). Security boundaries: [../docs/security.md](../docs/security.md).
