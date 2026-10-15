# area44/autofix

Runs linting and formatting scripts in your workspace and integrates with [autofix.ci](https://autofix.ci/).

## Usage

```yaml
name: autofix.ci

on:
  pull_request:
  push:
    branches: ["main"]

permissions:
  contents: read

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run autofix
        uses: area44/workflows/autofix@main
```

## Architecture and Responsibilities

The Autofix composite action is structured with clear separation of responsibilities across declarative YAML and modular TypeScript modules:

- **`autofix/action.yml`**: Keeps the composite action declarative and concise. Declares required environment setup actions (`actions/setup-node`, `oven-sh/setup-bun`, `pnpm/setup`, `actions/setup-python`, `astral-sh/setup-uv`), executes the generated TypeScript entrypoint (`dist/autofix.mjs`), and delegates Python formatting/linting to pinned `astral-sh/ruff-action` steps.
- **`src/autofix.ts`**: The main orchestration entrypoint. Evaluates the resolved environment, determines applicable project scripts, coordinates dependency installation plans, executes matching scripts, and triggers Python environment setup.
- **`src/javascript-env.ts`**: Dedicated JavaScript/TypeScript environment module. Inspects package manifests (`package.json`), detects package managers (`npm`, `pnpm`, `bun`) and version configurations (`packageManager`, `devEngines`), detects supported lockfiles, generates deterministic lockfile-respecting installation plans, and evaluates script selection precedence.
- **`src/python-env.ts`**: Owns Python-specific environment detection, Python version resolution, Python package manager detection (`uv`, `pip`), and Ruff version resolution from lockfiles and manifests.

## Public API Contract

### Inputs

| Name      | Description                                                   | Default | Required |
| --------- | ------------------------------------------------------------- | ------- | -------- |
| `runtime` | Optional runtime and version override (e.g. node@24, bun@1.4) |         | Optional |

### Outputs

| Name                      | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `node-version`            | The Node.js version used                                              |
| `bun-version`             | The Bun version used                                                  |
| `package-manager`         | The package manager used                                              |
| `package-manager-version` | The version of the package manager used                               |
| `runtime`                 | The runtime used (node or bun)                                        |
| `has-python-source`       | Whether Python source code was detected                               |
| `python-version`          | The Python version used                                               |
| `python-package-manager`  | The Python package manager detected (uv or pip)                       |
| `ruff-version`            | The Ruff version specified by the project or empty string for default |

## JavaScript & TypeScript Dependency Handling

### Package Manager & Lockfile Behavior

Autofix inspects the project environment to determine the appropriate package manager (`npm`, `pnpm`, or `bun`) and generates a deterministic, lockfile-respecting installation plan:

- **`npm`**:
  - **With `package-lock.json`**: Executes `npm ci` (frozen lockfile installation).
  - **Without lockfile**: Falls back to `npm install` (non-frozen installation).
- **`pnpm`**:
  - **With `pnpm-lock.yaml`**: Executes `pnpm install --frozen-lockfile` (frozen lockfile installation).
  - **Without lockfile**: Falls back to `pnpm install --no-frozen-lockfile` (non-frozen installation).
- **`bun`**:
  - **With `bun.lock` or `bun.lockb`**: Executes `bun install --frozen-lockfile` (frozen lockfile installation).
  - **Without lockfile**: Falls back to `bun install` (non-frozen installation).

### Dependency Installation Skipping

To optimize execution speed, dependency installation is handled intelligently:

- **Skipped when no matched scripts exist**: If `package.json` contains no matching scripts (`check`, `format`, `fmt`, `lint`), JavaScript dependency installation is automatically skipped.
- **Executed when scripts require dependencies**: If any selected project script is found, dependencies are installed prior to script execution.
- **`SKIP_JS_INSTALL=true`**: Environment flag that explicitly skips JavaScript dependency installation when dependencies are pre-installed (such as in testing environments).

## Python Tooling Support

The Autofix action conditionally sets up Python environment tools and runs Ruff for linting and formatting alongside JavaScript/TypeScript tooling.

### Python Source Detection Rules

Python setup and Ruff execution are strictly gated on the presence of actual Python source files (`.py` or `.pyi`) in the workspace outside excluded directories (such as `.venv`, `node_modules`, `dist`, `build`, `.git`, etc.):

- **Source Code Prerequisite**: A repository must contain `.py` or `.pyi` source files to trigger Python setup, dependency installation, or Ruff execution.
- **Metadata and Configuration Only**: The presence of `pyproject.toml`, `[tool.ruff]`, `requirements.txt`, or other manifests without `.py` or `.pyi` files will not trigger Python setup or Ruff.
- **Mixed-Language Repositories**: Repositories containing both JavaScript/TypeScript and Python code continue running language-specific autofix steps and run Ruff when Python source files exist.

### Python Package Manager Detection

When Python source files are detected, supported dependency package managers are identified in deterministic priority:

- `uv`: Detected via `uv.lock` or `[tool.uv]` table in `pyproject.toml`.
- `pip`: Detected via `requirements.txt`, `setup.py`, `setup.cfg`, or standard `pyproject.toml`.

Supported package managers are `uv` and `pip`. If a required package manager binary is unavailable in PATH, the workflow fails fast with a clear error without attempting undocumented installation fallbacks.

### Single Ruff Execution Mechanism

All Python formatting and linting are handled exclusively by the pinned GitHub Action `astral-sh/ruff-action`:

- **Single Architecture**: No inline Ruff installations or custom runners (`uvx`, `pipx`, `python -m ruff`) are executed by the action scripts.
- **Ruff Operations**:
  - Code formatting: `ruff format .`
  - Code linting & autofix: `ruff check --fix .`
- **Ruff Version Resolution**:
  - Exact pins (`ruff==0.4.2`, `0.4.2`, `@0.4.2`) in `uv.lock`, `pyproject.toml` (excluding `[tool.ruff]` configuration blocks), or `requirements.txt` are passed to `astral-sh/ruff-action`.
  - Non-exact range constraints (`>=`, `^`, `~=`) return an empty string, allowing `astral-sh/ruff-action` to use its documented default version.

### Skip Environment Options

- `SKIP_PYTHON_INSTALL=true`: Skips project dependency installation when dependencies are already pre-installed, while continuing to run `ruff-action` when Python source files are present.
- `SKIP_JS_INSTALL=true`: Skips JavaScript dependency installation when JavaScript dependencies are pre-installed.

## Compatibility Considerations

- Supported JavaScript package managers are `npm`, `pnpm`, and `bun`. Legacy or unsupported package managers (such as `yarn`) produce an explicit failure with clear actionable messages.
- If a frozen installation fails (for example, due to an out-of-sync lockfile), the action does not silently retry with non-frozen flags, preserving reproducible build guarantees.
