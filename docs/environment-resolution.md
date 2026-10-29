# Environment Resolution & Setup Planning Algorithm

This document serves as the canonical technical reference for repository detection, environment resolution, runtime and package manager selection, setup planning, and GitHub Actions output generation in `@area44/workflows`.

---

## Architecture Overview

Environment resolution and action execution are structured as a pipeline of decoupled, single-responsibility modules in `src/`:

```
Repository Files & Configuration
               │
               ▼
┌──────────────────────────────┐
│ Environment Resolution Layer │
│  - inspectJsProjectEnv()     │
│  - findPythonProjectContext()│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│      Signal Collection       │
│  - collectRuntimeSignals()   │
│  - hasPythonSource()         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Conflict Validation &        │
│    Precedence Resolution     │
│  - validateRuntimeConflicts()│
│  - resolveJsEnvironment()    │
│  - resolvePythonEnvironment()│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Resolved Environment     │
│     ResolvedEnvironment      │
│  { javascript, python }      │
└──────────────┬───────────────┘
               │
               ├───────────────────────────────┐
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│      Setup Plan Layer        │ │       Outputs Writing        │
│  - createSetupPlan()         │ │  - writeOutput()             │
│  (Pure, zero side-effects)   │ │  (Sets step outputs)         │
└──────────────┬───────────────┘ └──────────────┬───────────────┘
               │                               │
               └───────────────┬───────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                   GitHub Actions Execution                   │
│  - pages/action.yml / autofix/action.yml Step Guards         │
│  - pnpm/setup, oven-sh/setup-bun, actions/setup-node        │
│  - astral-sh/setup-uv, actions/setup-python                  │
│  - voidzero-dev/setup-vp, astral-sh/ruff-action               │
└──────────────────────────────────────────────────────────────┘
```

### Module Responsibilities & Boundaries

| Module                                                                                    | Responsibilities                                                                                                                                                                                                                                                                                                                                               | Key Functions                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/javascript-env.ts`](../src/javascript-env.ts)                                       | Inspects JavaScript/TypeScript project files (`package.json`, version files, lockfiles), validates conflicting signals, resolves runtime (`node` or `bun`), resolves package manager (`npm`, `pnpm`, or `bun`), resolves runtime and package manager versions, and detects toolchain (`vite` or `vite-plus`).                                                  | `inspectJsProjectEnvironment()`, `resolveRuntime()`, `resolveJsPackageManager()`, `resolveNodeVersion()`, `resolveBunVersion()`, `resolveToolchain()`, `resolveJsEnvironment()` |
| [`src/python-env.ts`](../src/python-env.ts)                                               | Traverses project and parent directories for Python manifests/lockfiles (`pyproject.toml`, `uv.toml`, `uv.lock`, `requirements.txt`, `setup.py`, `setup.cfg`, `.python-version`, `runtime.txt`), checks for Python source files (`.py`/`.pyi`), resolves Python version, detects Python package manager (`uv` or `pip`), and extracts Ruff version specifiers. | `hasPythonSource()`, `findPythonProjectContext()`, `resolvePythonVersion()`, `detectPythonPackageManager()`, `resolveRuffVersion()`, `resolvePythonEnvironment()`               |
| [`src/resolve-environment.ts`](../src/resolve-environment.ts)                             | Serves as the resolution orchestrator entrypoint. Invokes JS and Python resolution, validates the aggregate `ResolvedEnvironment` structure, logs detection results via `@actions/core.info`, derives the `SetupPlan`, and sets GitHub Actions outputs.                                                                                                        | `resolveEnvironment()`, `validateEnvironment()`, `writeOutput()`, `run()`                                                                                                       |
| [`src/setup-plan.ts`](../src/setup-plan.ts)                                               | A **pure, deterministic transformation layer** with zero filesystem access or action side effects. Accepts a `ResolvedEnvironment` and generates a `SetupPlan` (`node`, `bun`, `pnpm`).                                                                                                                                                                        | `planNodeSetup()`, `planBunSetup()`, `planPnpmSetup()`, `resolvePnpmSetupRuntime()`, `createSetupPlan()`                                                                        |
| [`pages/action.yml`](../pages/action.yml) & [`autofix/action.yml`](../autofix/action.yml) | Composite action step declarations consuming outputs set by `resolveEnvironment` to execute setup actions, dependency installs, builds, autofix scripts, and artifact uploads.                                                                                                                                                                                 | Composite Action Step Definitions                                                                                                                                               |

---

## Repository Detection

Repository detection determines whether a repository contains JavaScript/TypeScript and/or Python project configurations.

### JavaScript / TypeScript Project Detection

A JavaScript/TypeScript project is detected (`javascript.detected = true`) if any of the following files exist in the repository root directory (inspected via `inspectJsProjectEnvironment()`):

- `package.json`
- `pnpm-lock.yaml`
- `package-lock.json`
- `bun.lock`

`javascript.detected` is `true` if `hasPackageJson`, `hasPnpmLock`, `hasPackageLock`, or `hasBunLock` is `true`.

### Python Project Detection

Python environment resolution (`resolvePythonEnvironment()`) evaluates `hasPythonSource(cwd)`. Python source code detection requires at least one `.py` or `.pyi` file existing within the repository directory tree, excluding specified dependency, virtual environment, cache, and build output directories.

#### Excluded Directories (`DEFAULT_EXCLUDED_DIRS`)

Directory traversal recursively inspects all subdirectories except:

`.git`, `.venv`, `venv`, `env`, `.env`, `virtualenv`, `.virtualenv`, `conda-env`, `.conda`, `node_modules`, `site-packages`, `__pycache__`, `.tox`, `.nox`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `dist`, `build`, `*.egg-info`, `.next`, `.astro`, `out`, `vendor`, `.yarn`.

_Note:_ Python files in test folders (`tests/`, `__tests__/`) are treated as standard source files and trigger Python environment detection.

If no `.py` or `.pyi` source files exist outside excluded directories, `resolvePythonEnvironment()` returns:

```ts
{
  detected: false,
  version: "",
  packageManager: null,
  ruffVersion: ""
}
```

### Mixed Repositories

Repositories containing both JavaScript configuration files and Python source files are detected as mixed repositories (`javascript.detected = true` and `python.detected = true`). JavaScript and Python environments are resolved independently by their respective domain resolvers (`resolveJsEnvironment` and `resolvePythonEnvironment`) without interfering with each other.

### Unrecognized Repositories

When neither a JavaScript project nor Python source code is detected:

- `resolveEnvironment()` logs an informational message via `core.info`: _"Neither JavaScript/TypeScript nor Python project detected. Default configuration will be used for any required resolution."_
- `javascript.detected` is `false` (defaulting runtime to `"node"`, version to `"24"`, package manager to `"npm"`, version `"12"`, toolchain `"vite"`).
- `python.detected` is `false` (`version` is `""`, `packageManager` is `null`, `ruffVersion` is `""`).
- `SetupPlan` sets all setup flags (`setup-node`, `setup-bun`, `setup-pnpm`, `setup-python`) to `false`.

---

## JavaScript Runtime Resolution

`resolveRuntime(pm, project)` selects the JavaScript runtime (`node` or `bun`).

### Supported Signals

1. **Package Manager (`hasBunPm`)**: Package manager resolved as `bun` (via `packageManager: "bun@..."`, `devEngines.packageManager`, or `bun.lock`).
2. **`package.json` `devEngines`**:
   - `hasBunDevEngine`: `devEngines.bun` or `devEngines.runtime` specifying `bun`.
   - `hasNodeDevEngine`: `devEngines.node` or `devEngines.runtime` specifying `node`.
3. **Version Files**:
   - `hasBunVersionFile`: `.bun-version` exists.
   - `hasNodeVersionFile`: `.nvmrc` or `.node-version` exists (`nodeFile`).

### Conflict Validation Rules (`validateRuntimeConflicts`)

Before applying precedence, `collectRuntimeSignals()` collects all runtime signals and `validateRuntimeConflicts()` validates them. If any contradictory declarations are present, an explicit `Error` is thrown:

1. **Both runtimes in `devEngines`**: `hasBunDevEngine && hasNodeDevEngine`
   - _Error:_ `"Conflicting runtime configuration in package.json devEngines: both Node.js and Bun runtimes are specified."`
2. **Bun package manager with Node `devEngines`**: `hasBunPm && hasNodeDevEngine`
   - _Error:_ `"Conflicting runtime configuration: packageManager indicates Bun but package.json devEngines specifies Node.js runtime."`
3. **Bun package manager with Node version file**: `hasBunPm && hasNodeVersionFile`
   - _Error:_ `"Conflicting runtime configuration: packageManager indicates Bun but Node.js version file (<file>) specifies Node.js runtime."`
4. **Conflicting version files without `devEngines` override**: `hasBunVersionFile && hasNodeVersionFile && !hasBunDevEngine && !hasNodeDevEngine`
   - _Error:_ `"Conflicting runtime version files detected: found both .bun-version and Node.js version file (<file>)."`
5. **Bun version file with Node `devEngines`**: `hasBunVersionFile && hasNodeDevEngine`
   - _Error:_ `"Conflicting runtime configuration: found .bun-version file but package.json devEngines specifies Node.js runtime."`
6. **Node version file with Bun `devEngines`**: `hasNodeVersionFile && hasBunDevEngine`
   - _Error:_ `"Conflicting runtime configuration: found Node.js version file (<file>) but package.json devEngines specifies Bun runtime."`

### Precedence Order

Once signals pass conflict validation, `resolveRuntime()` selects the runtime according to the following strict precedence:

```
1. devEngines.bun in package.json        ──► "bun"
2. devEngines.node in package.json       ──► "node"
3. .bun-version file                     ──► "bun"
4. .nvmrc or .node-version file          ──► "node"
5. Package manager is Bun (hasBunPm)     ──► "bun"
6. Default Fallback                      ──► "node"
```

### Runtime Choice vs. Version Resolution

Choosing a runtime (`"node"` or `"bun"`) is distinct from resolving its version:

- Selecting `"bun"` runtime resolves `bunVersion` via `resolveBunVersion()` and sets `nodeVersion` to `""`.
- Selecting `"node"` runtime resolves `nodeVersion` via `resolveNodeVersion()`. If Bun package manager or `.bun-version` is present, `bunVersion` is also resolved for package manager installation.

### JavaScript Runtime Resolution Decision Table

| `packageManager` / `devEngines.pm` | `devEngines.node` | `devEngines.bun` | `.nvmrc` / `.node-version` | `.bun-version` | `bun.lock` | Resolved Runtime | Outcome / Notes                                     |
| ---------------------------------- | ----------------- | ---------------- | -------------------------- | -------------- | ---------- | ---------------- | --------------------------------------------------- |
| `npm@12`                           | -                 | -                | -                          | -              | -          | **`node`**       | Default fallback                                    |
| `pnpm@12`                          | -                 | -                | `"24"`                     | -              | -          | **`node`**       | Node version file                                   |
| `bun@1.4`                          | -                 | -                | -                          | -              | -          | **`bun`**        | Bun package manager selects Bun runtime             |
| `pnpm@12`                          | -                 | -                | -                          | `"1.4.0"`      | -          | **`bun`**        | `.bun-version` selects Bun runtime                  |
| `pnpm@12`                          | `"24"`            | -                | -                          | -              | -          | **`node`**       | `devEngines.node` selects Node.js runtime           |
| `pnpm@12`                          | -                 | `"1.4.0"`        | -                          | -              | -          | **`bun`**        | `devEngines.bun` selects Bun runtime                |
| `pnpm@12`                          | `"24"`            | `"1.4.0"`        | -                          | -              | -          | **ERROR**        | Conflict: both Node and Bun in `devEngines`         |
| `bun@1.4`                          | `"24"`            | -                | -                          | -              | -          | **ERROR**        | Conflict: Bun PM with Node `devEngines`             |
| `bun@1.4`                          | -                 | -                | `"24"`                     | -              | -          | **ERROR**        | Conflict: Bun PM with Node version file             |
| `pnpm@12`                          | -                 | -                | `"24"`                     | `"1.4.0"`      | -          | **ERROR**        | Conflict: both `.bun-version` and Node version file |
| `pnpm@12`                          | `"24"`            | -                | -                          | `"1.4.0"`      | -          | **ERROR**        | Conflict: `.bun-version` with Node `devEngines`     |
| `pnpm@12`                          | -                 | `"1.4.0"`        | `"24"`                     | -              | -          | **ERROR**        | Conflict: Node version file with Bun `devEngines`   |
| -                                  | -                 | -                | -                          | -              | `bun.lock` | **`bun`**        | `bun.lock` infers Bun PM, selecting Bun runtime     |

---

## Package Manager and Version Resolution

### 1. JavaScript Package Manager & Version (`resolveJsPackageManager`)

Precedence rules:

1. **`package.json` `packageManager` field**: e.g. `"packageManager": "pnpm@12.15.0"`. Parsed into name (`pnpm`) and version (`12.15.0`).
2. **`package.json` `devEngines.packageManager`**: e.g. `"devEngines": { "packageManager": "bun@1.4.0" }`.
3. **Lockfile Detection Priority**:
   - `pnpm-lock.yaml` -> `pnpm` (default version `12`)
   - `package-lock.json` -> `npm` (default version `12`)
   - `bun.lock` -> `bun` (default version `1.4`)
     _Note:_ If multiple lockfiles exist without explicit `packageManager` config, a warning is emitted via `core.warning` detailing the conflicting files, and the highest-priority lockfile is selected.
4. **Default Fallback**: `npm` with default version `"12"` (`DEFAULT_NPM_VERSION`).

### 2. Node.js Version Resolution (`resolveNodeVersion`)

1. If runtime is `"bun"`, returns `""`.
2. `.nvmrc` or `.node-version` file contents in project directory.
3. `package.json` `devEngines.node` or `devEngines.runtime` version specifier.
4. If package manager is `"bun"`, returns `""`.
5. Default fallback: `"24"` (`DEFAULT_NODE_VERSION`).

### 3. Bun Version Resolution (`resolveBunVersion`)

1. `.bun-version` file contents in project directory.
2. Explicit `packageManager` field (`packageManager: "bun@<version>"`, including `"bun@latest"`) or `devEngines.packageManager` in `package.json`.
3. `package.json` `devEngines.bun` or `devEngines.runtime` version specifier.
4. If Bun is detected (via package manager `"bun"`, `bun.lock`, or `devEngines.bun`), defaults to `"1.4"` (`DEFAULT_BUN_VERSION`).
5. Otherwise returns `""`.

### 4. Python Version Resolution (`resolvePythonVersion`)

Precedence rules:

1. Local `.python-version` file in project directory.
2. `requires-python` field in project `pyproject.toml`.
3. Local `runtime.txt` file in project directory.
4. `requires-python` in workspace root `pyproject.toml` (when project is a workspace member).
5. Ancestor `.python-version` file (traversing up to repository root).
6. Ancestor `runtime.txt` file.
7. Default fallback: `"3.12"` (`DEFAULT_PYTHON_VERSION`).

### 5. Python Package Manager Resolution (`detectPythonPackageManager`)

Prioritizes `uv` over `pip`:

1. **`uv` Detection**:
   - **Locked UV project**: `uv.lock` is present. Requires a valid `pyproject.toml` (`[project]`, `[build-system]`, or `[tool.uv.workspace]`). Returns `name: "uv"`, `lockfile: "uv.lock"`, `configFile: "pyproject.toml"`, `installCommands: [{ executable: "uv", args: ["sync"] }]`.
     _Failure mode:_ If `uv.lock` exists without valid `pyproject.toml` project configuration, an explicit `Error` is thrown.
   - **Unlocked UV project**: `uv.toml` or `[tool.uv]` table in `pyproject.toml`. If `requirements.txt` exists, uses `uv pip install -r requirements.txt`; otherwise uses `uv sync`.
2. **`pip` Detection**:
   - Detected if `requirements.txt`, `setup.py`, `setup.cfg`, or `pyproject.toml` (`[project]` or `[build-system]`) exists.
   - If `requirements.txt` and package manifest (`setup.py`/`pyproject.toml`) exist: `pip install -r requirements.txt` followed by `pip install -e .`.
   - If only `requirements.txt` exists: `pip install -r requirements.txt`.
   - If only package manifest exists: `pip install -e .`.
3. **Standalone Python Project**:
   - Python source files exist without any manifest or lockfile. Returns `name: "pip"`, `installCommands: []`, `execPrefix: ""`, `isStandalone: true`.

### 6. Ruff Version Resolution (`resolveRuffVersion`)

Precedence rules:

1. Exact pinned version in `uv.lock` (`name = "ruff"` package block).
2. Dependency declaration in local `pyproject.toml`:
   - PEP 621 (`project.dependencies`, `project.optional-dependencies`)
   - PEP 735 (`dependency-groups`)
   - Tool tables (`tool.uv`, `tool.poetry`, `tool.pdm`, `tool.hatch`, `tool.pixi`)
3. Dependency declaration in workspace root `pyproject.toml`.
4. Dependency declaration in `uv.toml`.
5. Dependency declaration in `requirements.txt`.
6. Default fallback: `""` (empty string, causing `astral-sh/ruff-action` to provision default/latest Ruff).

_Version Extraction:_ `extractRuffVersionSpecifier()` extracts exact pins (`==0.4.2`, `@0.4.2`, `0.4.2`). Range specifiers or version constraints (e.g. `>=0.3.0,<0.5.0`, `^0.4.0`) return `""` to allow `ruff-action` to handle version resolution cleanly.

---

## Toolchain Detection

`resolveToolchain(toolchainInput, project)` determines the JavaScript build toolchain (`"vite"` or `"vite-plus"`).

### Signals & Precedence

1. **Explicit Action Input**: If `toolchainInput` is supplied and not `"auto"`:
   - Accepts `"vite"` or `"vite-plus"`.
   - Any other value throws an `Error`: `'Invalid toolchain input: unsupported value. Supported values are "auto", "vite", or "vite-plus".'`
2. **Automatic Dependency Detection**: Inspects `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, and pnpm `catalog`/`catalogs`) for keys or string values matching:
   - `vite-plus`
   - `@voidzero-dev/vite-plus`
   - `@voidzero-dev/vite-plus-core`
   - `@voidzero-dev/vite-plus-*`
     If matching dependencies exist, resolves to `"vite-plus"`.
3. **Default Fallback**: `"vite"`.

### Impact on Action Execution

- **`vite-plus`**: `pages/action.yml` runs `voidzero-dev/setup-vp`. In `pages/action.yml`, default build command is set to `vp build`. `resolveBuildCommandToParse()` in `src/pages/build-command.ts` checks PATH for `vp` using `@actions/io.which()` and falls back to `vpr build` if `vp` is not on PATH.
- **`vite`**: `pages/action.yml` runs package manager setup (`actions/setup-node`, `oven-sh/setup-bun`, or `pnpm/setup`) and executes `install_dependencies` (`npm ci` / `pnpm install --frozen-lockfile` / `bun install --frozen-lockfile`). Default build command is `<package-manager> run build`.

---

## Setup Plan Algorithm

`src/setup-plan.ts` contains pure transformation functions converting a `ResolvedEnvironment` into a `SetupPlan`.

### Data Types

```ts
export interface NodeSetupPlan {
  shouldSetup: boolean;
  version: string;
  cache: string;
}

export interface BunSetupPlan {
  shouldSetup: boolean;
  version: string;
}

export interface PnpmSetupPlan {
  shouldSetup: boolean;
  pnpmRuntime: string;
}

export interface SetupPlan {
  node: NodeSetupPlan;
  bun: BunSetupPlan;
  pnpm: PnpmSetupPlan;
}
```

### Pure Transformation Functions

- `planNodeSetup(js)`:
  - `shouldSetup`: `js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "node"`
  - `version`: `js.runtime.name === "node" ? js.runtime.version : DEFAULT_NODE_VERSION` ("24")
  - `cache`: `js.detected && js.packageManager.name === "npm" ? "npm" : ""`
- `planBunSetup(js)`:
  - `shouldSetup`: `js.detected && js.packageManager.name !== "pnpm" && js.runtime.name === "bun"`
  - `version`: `js.runtime.name === "bun" ? js.runtime.version : DEFAULT_BUN_VERSION` ("1.4")
- `planPnpmSetup(js)`:
  - `shouldSetup`: `js.detected && js.packageManager.name === "pnpm"`
  - `pnpmRuntime`: derived via `resolvePnpmSetupRuntime(js)`
- `resolvePnpmSetupRuntime(js)`:
  - If `js.runtime.name === "bun"`, returns `bun@${js.runtime.version}`.
  - If `js.runtime.name === "node"` and `js.runtime.version` is non-empty and does not start with `"lts"`, returns `node@${js.runtime.version}`.
  - Otherwise returns `"node@lts"`.
- `createSetupPlan(env)`: Combines `planNodeSetup(env.javascript)`, `planBunSetup(env.javascript)`, and `planPnpmSetup(env.javascript)`.

### Setup Plan Decision Table

| Scenario        | `js.detected` | `runtime.name` | `pm.name` | `toolchain` | `node.shouldSetup` | `node.version` | `node.cache` | `bun.shouldSetup` | `bun.version` | `pnpm.shouldSetup` | `pnpm.pnpmRuntime` |
| --------------- | ------------- | -------------- | --------- | ----------- | ------------------ | -------------- | ------------ | ----------------- | ------------- | ------------------ | ------------------ |
| Node + npm      | `true`        | `node`         | `npm`     | `vite`      | `true`             | `"24"`         | `"npm"`      | `false`           | `"1.4"`       | `false`            | `"node@lts"`       |
| Node + pnpm     | `true`        | `node`         | `pnpm`    | `vite`      | `false`            | `"24"`         | `""`         | `false`           | `"1.4"`       | `true`             | `"node@24"`        |
| Bun + Bun PM    | `true`        | `bun`          | `bun`     | `vite`      | `false`            | `"24"`         | `""`         | `true`            | `"1.4"`       | `false`            | `"bun@1.4"`        |
| Bun + pnpm      | `true`        | `bun`          | `pnpm`    | `vite`      | `false`            | `"24"`         | `""`         | `false`           | `"1.4"`       | `true`             | `"bun@1.4"`        |
| Vite+ with Node | `true`        | `node`         | `npm`     | `vite-plus` | `true`             | `"24"`         | `"npm"`      | `false`           | `"1.4"`       | `false`            | `"node@lts"`       |
| Vite+ with Bun  | `true`        | `bun`          | `bun`     | `vite-plus` | `false`            | `"24"`         | `""`         | `true`            | `"1.4"`       | `false`            | `"bun@1.4"`        |
| No JS Project   | `false`       | `node`         | `npm`     | `vite`      | `false`            | `"24"`         | `""`         | `false`           | `"1.4"`       | `false`            | `"node@lts"`       |

---

## Action Outputs and Conditional Execution

`writeOutput(env)` writes outputs to GitHub Actions runner context via `core.setOutput()`.

### Internal Setup Outputs vs. Public Action Outputs

```
ResolvedEnvironment ──► writeOutput() ──┬──► Internal Setup Outputs (Step Orchestration)
                                       │    - node-version, bun-version, pnpm-runtime
                                       │    - setup-node, setup-node-cache, setup-bun, setup-pnpm, setup-python
                                       │
                                       └──► Public Ecosystem Outputs (Action Consumers)
                                            - javascript-detected, javascript-runtime, javascript-runtime-version
                                            - javascript-package-manager, javascript-package-manager-version
                                            - javascript-toolchain, python-detected, python-version
                                            - python-package-manager, ruff-version
```

### Action Output Consumer Mapping

#### `pages/action.yml`

| Step                 | Output Guard / Trigger Condition                 | Uses / Tool Executed                                  | Key Parameters Passed                                                  |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Resolve environment  | Unconditional                                    | `node "$ACTION_PATH/../dist/resolve-environment.mjs"` | Sets all outputs                                                       |
| Set site variables   | `steps.resolve_environment.outcome == 'success'` | `node "$ACTION_PATH/../dist/site-variables.mjs"`      | Exports `SITE`, `BASE`, `BASE_URL`                                     |
| Setup PNPM           | `setup-pnpm == 'true'`                           | `pnpm/setup@v3`                                       | `version: javascript-package-manager-version`, `runtime: pnpm-runtime` |
| Setup Bun            | `setup-bun == 'true'`                            | `oven-sh/setup-bun@v2`                                | `bun-version: bun-version`                                             |
| Setup Node.js        | `setup-node == 'true'`                           | `actions/setup-node@v7`                               | `node-version: node-version`, `cache: setup-node-cache`                |
| Setup Vite+          | `javascript-toolchain == 'vite-plus'`            | `voidzero-dev/setup-vp@v1`                            | `node-version: node-version`                                           |
| Install dependencies | `javascript-toolchain != 'vite-plus'`            | Bash script (`npm ci`, `pnpm install`, `bun install`) | `PACKAGE_MANAGER`                                                      |
| Build site           | `install_dependencies.outcome == 'success'       |                                                       | setup_vp.outcome == 'success'`                                         | `node "$ACTION_PATH/../dist/build-command.mjs"` | `BUILD_COMMAND`, `BUILD_PATH` |
| Upload site artifact | `build_site.outcome == 'success'`                | `actions/upload-pages-artifact@v5`                    | `path: steps.build_site.outputs.path`                                  |

#### `autofix/action.yml`

| Step                | Output Guard / Trigger Condition                                      | Uses / Tool Executed                                  | Key Parameters Passed                                                  |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Resolve environment | Unconditional                                                         | `node "$ACTION_PATH/../dist/resolve-environment.mjs"` | Sets all outputs                                                       |
| Setup uv            | `python-detected == 'true' && python-package-manager == 'uv'`         | `astral-sh/setup-uv`                                  | `python-version: python-version`                                       |
| Setup Python        | `python-detected == 'true' && python-package-manager != 'uv'`         | `actions/setup-python@v7`                             | `python-version: python-version`                                       |
| Setup PNPM          | `setup-pnpm == 'true'`                                                | `pnpm/setup@v3`                                       | `version: javascript-package-manager-version`, `runtime: pnpm-runtime` |
| Setup Bun           | `setup-bun == 'true'`                                                 | `oven-sh/setup-bun@v2`                                | `bun-version: bun-version`                                             |
| Setup Node.js       | `setup-node == 'true'`                                                | `actions/setup-node@v7`                               | `node-version: node-version`, `cache: setup-node-cache`                |
| Setup Ruff          | `python-detected == 'true'`                                           | `astral-sh/ruff-action`                               | `version: ruff-version`                                                |
| Run autofix         | `javascript-detected == 'true'                                        |                                                       | python-detected == 'true'`                                             | `node "$ACTION_PATH/../dist/autofix.mjs"` | `PACKAGE_MANAGER`, `RUNTIME`, setup outcomes |
| Run autofix.ci      | `run_autofix.outcome == 'success' && github.workflow == 'autofix.ci'` | `autofix-ci/action@v1`                                | Automated commit creation                                              |

---

## Worked Examples and Troubleshooting

### Example 1: Node.js + pnpm Repository with `.nvmrc`

#### Repository Structure

```
├── .nvmrc              # "22.11.0"
├── package.json        # "packageManager": "pnpm@12.15.0"
└── pnpm-lock.yaml
```

#### Resolved State & Outputs

```ts
{
  javascript: {
    detected: true,
    runtime: { name: "node", version: "22.11.0" },
    packageManager: { name: "pnpm", version: "12.15.0" },
    toolchain: "vite"
  },
  python: { detected: false, version: "", packageManager: null, ruffVersion: "" }
}
```

#### Setup Plan Decisions

- `setup-node`: `"false"` (`pnpm/setup` manages runtime)
- `setup-bun`: `"false"`
- `setup-pnpm`: `"true"`
- `pnpm-runtime`: `"node@22.11.0"`

---

### Example 2: Bun + Vite+ Repository

#### Repository Structure

```
├── .bun-version        # "1.2.2"
├── package.json        # dependencies: { "@voidzero-dev/vite-plus": "^1.4.0" }, "packageManager": "bun@1.2.2"
└── bun.lock
```

#### Resolved State & Outputs

```ts
{
  javascript: {
    detected: true,
    runtime: { name: "bun", version: "1.2.2" },
    packageManager: { name: "bun", version: "1.2.2" },
    toolchain: "vite-plus"
  },
  python: { detected: false, version: "", packageManager: null, ruffVersion: "" }
}
```

#### Setup Plan Decisions & Outputs

- `setup-node`: `"false"`
- `setup-bun`: `"true"` (`bun-version`: `"1.2.2"`)
- `setup-pnpm`: `"false"`
- `javascript-toolchain`: `"vite-plus"` (`pages` triggers `voidzero-dev/setup-vp`)

---

### Example 3: Mixed JavaScript/Python Repository (`uv` + Node.js)

#### Repository Structure

```
├── .python-version     # "3.11"
├── pyproject.toml      # [project] name="my-app", dependencies=["ruff==0.4.2"]
├── uv.lock
├── src/
│   └── app.py
├── package.json        # "packageManager": "pnpm@12.15.0"
└── pnpm-lock.yaml
```

#### Resolved State & Outputs

```ts
{
  javascript: {
    detected: true,
    runtime: { name: "node", version: "24" },
    packageManager: { name: "pnpm", version: "12.15.0" },
    toolchain: "vite"
  },
  python: {
    detected: true,
    version: "3.11",
    packageManager: { name: "uv", lockfile: "uv.lock", configFile: "pyproject.toml" ... },
    ruffVersion: "0.4.2"
  }
}
```

#### Setup Plan Decisions & Outputs

- `setup-node`: `"false"`
- `setup-pnpm`: `"true"` (`pnpm-runtime`: `"node@lts"`)
- `setup-python`: `"true"`
- `python-detected`: `"true"`, `python-package-manager`: `"uv"`, `ruff-version`: `"0.4.2"`

---

### Example 4: Validation Error Scenario — Conflicting Runtime Configurations

#### Repository Structure

```
├── .bun-version        # "1.4.0"
└── package.json        # "devEngines": { "node": "24.0.0" }
```

#### Validation Result & Failure Behavior

`validateRuntimeConflicts()` detects `.bun-version` paired with `devEngines.node`:

- **Execution Result:** Step fails immediately via `core.setFailed()`.
- **Error Message:** `"Environment setup failed: Conflicting runtime configuration: found .bun-version file but package.json devEngines specifies Node.js runtime."`

---

### Example 5: Validation Error Scenario — `uv.lock` Without Project Manifest

#### Repository Structure

```
├── uv.lock
└── src/
    └── script.py
```

#### Validation Result & Failure Behavior

`detectUvFromContext()` detects `uv.lock` without a valid `pyproject.toml` (`[project]`, `[build-system]`, or `[tool.uv.workspace]`):

- **Execution Result:** Step fails immediately via `core.setFailed()`.
- **Error Message:** `"Environment setup failed: Invalid Python project configuration: 'uv.lock' was detected without a valid 'pyproject.toml' project or workspace configuration ('[project]', '[build-system]', or '[tool.uv.workspace]'). 'uv sync' requires a valid 'pyproject.toml' file."`

---

## Related Source Files and Unit Tests

- **Resolution Implementation**: [`src/resolve-environment.ts`](../src/resolve-environment.ts), [`src/javascript-env.ts`](../src/javascript-env.ts), [`src/python-env.ts`](../src/python-env.ts)
- **Setup Planning**: [`src/setup-plan.ts`](../src/setup-plan.ts)
- **Composite Action Contracts**: [`pages/action.yml`](../pages/action.yml), [`autofix/action.yml`](../autofix/action.yml)
- **Unit & Integration Tests**:
  - [`__tests__/resolve-environment.test.ts`](../__tests__/resolve-environment.test.ts)
  - [`__tests__/javascript-env.test.ts`](../__tests__/javascript-env.test.ts)
  - [`__tests__/python-env.test.ts`](../__tests__/python-env.test.ts)
  - [`__tests__/setup-plan.test.ts`](../__tests__/setup-plan.test.ts)
  - [`__tests__/autofix.test.ts`](../__tests__/autofix.test.ts)
  - [`__tests__/build-command.test.ts`](../__tests__/build-command.test.ts)
