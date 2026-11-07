# area44/autofix

Automatically format and fix code.

## Action Purpose

The `autofix` composite action automatically formats and fixes code across multiple languages using a modular, capability-based architecture with default toolchains, hybrid detection, and extensible tool adapters.

## Core Architectural Principles

1. **Default Python Toolchain (Ruff):** Python uses Ruff as the default linting and formatting toolchain. Ruff does not require dependency detection, script detection, or project-specific Ruff declarations in `pyproject.toml`, requirements files, or lockfiles. When Python source files (`.py`/`.pyi`) are detected, Ruff is automatically executed via official `astral-sh/ruff-action` provisioning.
2. **JavaScript/TypeScript Hybrid Detection:** Combines explicit project scripts, project-native toolchains (Vite+), and tool capability detection (ESLint, Prettier, Biome, Oxlint, Oxfmt).
3. **Explicit Project Intent Priority:** Explicit project scripts always take precedence over inferred tool adapters and are never silently overridden.
4. **Deterministic Conflict Resolution:** Prevents overlapping formatters and linters from running over the same files without an explicit selection policy.
5. **Language-Agnostic Core Orchestrator:** Tool detection, capability planning, and task execution are decoupled from language-specific environment setup.
6. **Extensible Static Registry:** New tools and languages can be registered without modifying the core orchestrator.

## Features and Supported Behavior

- **Automatic Environment Detection:** Automatically detects Node.js, Bun, and Python environments and package managers (`npm`, `pnpm`, `bun`, `uv`, `pip`).
- **Separation of Setup and Installation:** Official setup actions (`actions/setup-node`, `pnpm/setup`, `oven-sh/setup-bun`, `actions/setup-python`, `astral-sh/setup-uv`, `astral-sh/ruff-action`) provision runtimes, CLI tools, and caches. Dependency installations and autofix executions are performed reliably in TypeScript.
- **Python Formatting and Linting:** Provisions Ruff and executes `ruff check --fix .` (lint capability) and `ruff format .` (format capability) sequentially whenever Python source code is detected. No duplicate installation through `pip` or `uv` is performed.
- **JavaScript/TypeScript Hybrid Detection:**
  - **Explicit Script Priority:** Recognizes standard script conventions:
    - Combined autofix: `fix`, `check:fix`
    - Format write: `format`, `fmt`, `format:write`, `format:fix`
    - Format check: `format:check`, `fmt:check`
    - Lint fix: `lint:fix`, `lint:write`
    - Lint check: `lint`, `lint:check`
  - **Excluded Scripts:** Validation-only scripts such as plain `lint`, `lint:check`, `check`, `test`, and `typecheck` are strictly excluded from execution as autofix commands in fix mode.
  - **Generic "fix" Interaction:** A generic `fix` script does not blindly suppress independently declared format or lint fix scripts unless it demonstrably delegates to them.
  - **Tool Adapters:** When explicit scripts are absent or specialized, detects configured tools:
    - **Vite+:** Project-native toolchain (`vp fmt` and `vp lint --fix` in fix mode, avoiding unnecessary type-checking or validation).
    - **Biome:** Fast unified toolchain supporting discrete formatting (`biome format --write .` / `biome format .`), safe lint fixes (`biome lint --write .` / `biome lint .`), and safe Assist actions (`biome check --write --formatter-enabled=false --linter-enabled=false .` / `biome check --formatter-enabled=false --linter-enabled=false .`). The `assist` capability is independent of `format` and `lint`; having separate format and lint scripts does not suppress Assist actions unless a generic `fix` script covers the full `autofix` lifecycle.
    - **Prettier:** Code formatter (`prettier --write .`).
    - **ESLint:** Pluggable JavaScript/TypeScript linter (`eslint --fix .`).
    - **Oxlint:** High-performance JavaScript linter (`oxlint --fix .`).
    - **Oxfmt:** High-performance code formatter (`oxfmt --write .`).
  - **Intentional Configuration Requirement:** Dependency presence alone is not sufficient to run a tool; active configuration files (e.g., `biome.json`, `.prettierrc`, `eslint.config.js`) or manifest configuration sections must be detected.
  - **Execution-Time Executable Resolution:** Adapters construct declarative task definitions during planning without requiring local executables to exist in `node_modules/.bin` beforehand. Dependencies are installed and provisioned prior to task execution, at which point local project binaries are safely resolved (with actionable missing-dependency diagnostics if absent).
- **Explainable Execution Plan:** Logs a readable execution summary detailing detected environments, selected tools, skipped tools with reasons (e.g. overlapping capabilities), and the planned tasks.
- **Independent Execution:** JavaScript and Python workflows run independently within the same action step, aggregating diagnostics and failures.
- **autofix.ci Integration:** Automatically invokes `autofix-ci/action` when running inside the `autofix.ci` workflow context.

## Execution Plan Example

During action execution, the planner emits an explainable log:

```text
Detected environments:
  Python: true
  JavaScript: true

Python toolchain:
  Ruff: default tool

JavaScript toolchain:
  ESLint: selected
  Prettier: selected
  Biome: skipped (overlapping capabilities already covered by higher priority tool)

Execution plan:
  1. Ruff: lint autofix
  2. Ruff: format
  3. Prettier: format
  4. ESLint: lint autofix

Skipped:
  - Biome: overlapping capabilities already covered by higher priority tool
```

## Adding New Tool Adapters & Languages

### Adding a Tool Adapter

To add a tool adapter within an existing language provider:

1. Implement the `ToolAdapter` interface (`src/autofix/types.ts`) defining `id`, `name`, `capabilities`, `detect(context)`, and `plan(context, mode)`.
2. Register the adapter in the relevant `LanguageProvider` (e.g., `src/autofix/providers/javascript.ts`).
3. Add unit tests verifying detection, planning, and conflict resolution.

### Adding a Language Provider

To add support for a new language (e.g., Go, Rust):

1. Implement the `LanguageProvider` interface (`src/autofix/types.ts`) defining `id`, `name`, `detect(context)`, and `getAdapters(context)`.
2. Register the provider in `createDefaultRegistry()` (`src/autofix/registry.ts`).
3. Add provider and adapter tests.

The core orchestrator remains completely untouched.

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
