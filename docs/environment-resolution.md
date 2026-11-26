# Environment Resolution

How the actions detect a repository's runtimes, package managers, and toolchains. Implemented in `src/resolve-environment.ts` (orchestration), `src/javascript-env.ts`, `src/python-env.ts`, and `src/setup-plan.ts` — those modules and their tests in `tests/` are the authoritative specification for exact behavior.

## Domains

JavaScript/TypeScript and Python resolve independently. A repo may contain either, both, or neither. When neither is detected, resolution logs `No JavaScript or Python environment detected.` and succeeds.

## Resolution

`run()` in `src/resolve-environment.ts` runs sequentially:

```mermaid
flowchart TD
    A[Repo files & config] --> B1[Resolve JS domain]
    A --> B2[Resolve Python domain]
    B1 --> C1{Validate JS signals}
    B2 --> C2{Validate Python config}
    C1 -- conflict --> FAIL[core.setFailed]
    C2 -- invalid --> FAIL
    C1 -- ok --> D1[Resolved JS env]
    C2 -- ok --> D2[Resolved Python env]
    D1 --> E[Aggregate env]
    D2 --> E
    E --> F{validateEnvironment}
    F -- violation --> FAIL
    F -- ok --> G[createSetupPlan]
    G --> H[core.setOutput]
```

## Rules

- **Delegated version resolution** — `actions/setup-node`, `pnpm/setup`, `oven-sh/setup-bun`, `actions/setup-python`, `astral-sh/setup-uv`, and `astral-sh/ruff-action` own version selection and installation. When `pnpm` is selected, `pnpm/setup` provisions it (and the runtime) directly, so the node/bun setup steps are skipped to avoid duplicate setup.
- **Runtime precedence** — `devEngines` declarations, then version files (`.bun-version` vs `.nvmrc`/`.node-version`), then package manager (`bun`), else Node.js. Contradictory signals (e.g. bun + node config) fail validation rather than applying a silent tie-breaker.
- **Package manager precedence** — `packageManager` field, then `devEngines.packageManager`, then lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `bun.lock`), else `npm`.
- **Toolchain** — `vite-plus` is the recognized toolchain, detected from a Vite+ dependency in `package.json`.
- **Python package manager** — `pip` by default; `uv` when `uv.lock` or explicit uv config (`[tool.uv]` / `uv.toml`) is present. `uv.lock` without a valid `pyproject.toml` is an error.
- **Pure setup plan** — `createSetupPlan(env)` is a pure transform (no filesystem access, no side effects) derived from the resolved environment, guaranteeing plan/environment consistency.

## Conflict handling

- Valid config → explicit runtime/package-manager/toolchain outputs.
- Undetected domain → `detected: false`, no error.
- Contradictory config or invariant violation (e.g. lockfile without required manifest) → `core.setFailed` and halt.

## Maintenance

When resolution behavior changes:

- Update `src/` and add or update tests in `tests/`.
- Keep this document's mermaid flow and rules in sync.
- Update the `README.md` / `pages/README.md` / `autofix/README.md` references if entrypoints change.

## Python Autofix Lifecycle

The Python Autofix provider (`src/autofix/providers/python.ts`) follows a specific lifecycle that separates **Python project detection** from **Python source detection**:

### Python Project Detection

- Determines whether the repository is a Python project based on dependency configuration.
- Recognizes: `pyproject.toml` with `[project]` or `[build-system]`, `uv.lock`, `requirements.txt`, `setup.py`, `setup.cfg`, `[tool.uv]` configuration, `uv.toml`.
- A project is detected even when no `.py`/`.pyi` source files exist.
- Used to decide whether to install/synchronize dependencies.

### Python Source Detection

- Determines whether Python source code exists (`.py`/`.pyi` files anywhere in the repo, including test directories).
- Used to decide whether to execute Ruff lint/format tasks.

### Execution Order

When a Python project is detected:

1. **Environment setup** — GitHub Actions provisions Python runtime and package manager (`actions/setup-python` or `astral-sh/setup-uv`).
2. **Dependency installation** — Runs `uv sync` (for uv projects) or `pip install` (for pip projects) automatically. This happens for ALL detected Python projects, regardless of whether source files exist.
   - For uv: `uv sync` is used without `--locked`, `--frozen`, or `--upgrade`. This allows uv to update `uv.lock` when synchronization requires it.
   - For pip: Dependencies are installed from detected configuration (`requirements.txt`, `pyproject.toml` `[project]`, `setup.py`, `setup.cfg`). Pip does not generate or update lockfiles.
3. **Ruff setup** — `astral-sh/ruff-action` provisions Ruff.
4. **Ruff lint autofix** — Runs `ruff check --fix .` **only when Python source files are detected**.
5. **Ruff formatting** — Runs `ruff format .` **only when Python source files are detected**, after lint autofix.

### Key Behaviors

- Dependency installation is **independent of Ruff execution**. A Python project with `uv.lock` but no `.py` files will still run `uv sync`.
- If dependency installation fails, Ruff does **not** execute. The action fails with the dependency installation error.
- JavaScript-only repositories never trigger Python setup or dependency installation.
- The `python-detected` output from environment resolution indicates a Python **project** was detected (not just source files).

### uv Lockfile Behavior

- `uv sync` is the single command used for uv projects.
- It automatically updates `uv.lock` when the lockfile is missing or outdated relative to `pyproject.toml`.
- No separate `uv lock` command is run.
- No `--locked`, `--frozen`, or `--upgrade` flags are used by default.

### pip Behavior

- Installs from detected configuration files.
- Does not generate or update lockfiles.
- Standalone projects (no dependency configuration) skip installation entirely.
