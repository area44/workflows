# area44/autofix

Automatically format and fix code.

## Action Purpose

The `autofix` composite action automatically formats and fixes code.

## Features and Supported Behavior

- **Automatic Environment Detection:** Automatically detects Node.js, Bun, and Python environments and package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`).
- **Separation of Setup and Installation:** Official setup actions (`actions/setup-node`, `pnpm/setup`, `oven-sh/setup-bun`, `actions/setup-python`, `astral-sh/setup-uv`, `astral-sh/ruff-action`) provision runtimes, CLI tools, and tool caches. Dependency installations (`npm install`, `pnpm install --no-frozen-lockfile`, `bun install`, `uv sync`, `pip install`) and autofix executions are performed reliably in TypeScript.
- **Dependency Synchronization & Early Skip:** Inspects project scripts before installing dependencies. If no matching autofix script exists in `package.json`, JavaScript dependency installation is cleanly skipped without modifying lockfiles or running package manager commands.
- **JavaScript/TypeScript Project Scripts:** Selects and executes repository-configured scripts (`fix`, `format`, `fmt`, `lint`, `check`) from `package.json`.
- **Python Formatting and Linting:** Provisions Ruff and executes `ruff check --fix .` and `ruff format .` sequentially whenever Python source code (`.py`/`.pyi`) is detected.
- **Independent Execution:** JavaScript and Python workflows run independently within the same action step, aggregating diagnostics and failures.
- **Provider-Owned Lifecycle:** Each language provider (`javascript`, `python`) owns its own setup and execution lifecycle. New languages are added by registering a provider and adapters in the registry — no changes to the central orchestrator are required.
- **Tool-Agnostic Execution Engine:** Tasks are executed by a single engine that resolves executables via a declarative strategy (`passthrough`, `path`, or `project-binary`) rather than by inspecting tool ids.
- **Actionable Execution Logging:** Every command that actually runs — dependency installation and task execution alike — is logged once as `Executing: <command>` with arguments quoted for clarity. Verbose environment summaries are not emitted.
- **autofix.ci Integration:** Automatically invokes `autofix-ci/action` when running inside the `autofix.ci` workflow context.

## Architecture

The autofix runner (`src/autofix/`) is organized into a small set of composable layers:

1. **Registry & Planner** — `planExecution()` walks registered language providers, detects their tools, resolves capability conflicts, and produces a deduplicated task list. The planner stamps each task with its owning `providerId`, so routing is driven by execution domain rather than individual tool ids.
2. **Orchestrator (`run()`)** — Builds the project context once, plans once, groups tasks by provider, and dispatches each provider's tasks. Providers run in a deterministic order defined by `executionOrder` (decoupled from registration/plan order).
3. **Language Providers** — Implement an optional `run(context, tasks, engine)` lifecycle hook that gates on setup outcomes, installs dependencies, and executes tasks. Providers without a custom lifecycle fall back to direct engine execution.
4. **Execution Engine** — Resolves each task's executable according to its `resolution` strategy and executes it, logging `Executing: <command>` before each run and aggregating failures with actionable messages.

Adding a new language requires only a new `LanguageProvider` (with adapters) registered in `createDefaultRegistry()`; the orchestrator and engine need no modification.

## Usage Example

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
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Run autofix
        uses: area44/workflows/autofix@main
```

## Public API Contract

### Inputs

This action accepts no inputs.

### Outputs

| Name                         | Description                                                |
| ---------------------------- | ---------------------------------------------------------- |
| `javascript-detected`        | Whether a JavaScript project (`package.json`) was detected |
| `javascript-runtime`         | The resolved JavaScript runtime (`node` or `bun`)          |
| `javascript-package-manager` | The package manager used (`npm`, `pnpm`, or `bun`)         |
| `python-detected`            | Whether Python source code (`.py`/`.pyi`) was detected     |
| `python-package-manager`     | The Python package manager detected (`uv` or `pip`)        |

## Related Documentation

- **[Repository README](../README.md)**: Project overview and action API summary.
- **[Environment Resolution Algorithm Guide](../docs/environment-resolution.md)**: Design principles, decision flow, conflict handling, and setup planning details.
- **[Error Handling Architecture](../docs/errors.md)**: Native JavaScript error boundaries, top-level error handling, and error logging.
- **[Security Boundaries](../docs/security.md)**: Input sanitization, argument tokenization, and command execution boundaries.
- **[Maintenance & Repository Health](../docs/maintenance.md)**: Maintenance workflows, build scripts, and quality gates.
- **[Integration Testing Guide](../docs/integration-testing.md)**: Module integration testing, fixture generators, and CI test harnesses.
