# Compatibility Contract and Release Policy

This document defines the compatibility contract, runtime and toolchain guarantees, composite action expectations, compatibility matrix, and release policy for `@area44/workflows`.

---

## Supported Runtime & Toolchain Versions

The repository's environment resolution (`src/resolve-environment.ts`) automatically discovers project settings or falls back to specified default versions.

### Canonical Default Versions

When a project does not specify a toolchain version in repository configuration files or workflow inputs, the action selects these canonical default versions:

| Toolchain | Default Version Constant | Default Value | Source Constant in `src/resolve-environment.ts` |
| --------- | ------------------------ | ------------- | ----------------------------------------------- |
| Node.js   | `DEFAULT_NODE_VERSION`   | `"24"`        | `export const DEFAULT_NODE_VERSION = "24"`      |
| Bun       | `DEFAULT_BUN_VERSION`    | `"1.4"`       | `export const DEFAULT_BUN_VERSION = "1.4"`      |
| npm       | `DEFAULT_NPM_VERSION`    | `"12"`        | `export const DEFAULT_NPM_VERSION = "12"`       |
| pnpm      | `DEFAULT_PNPM_VERSION`   | `"12"`        | `export const DEFAULT_PNPM_VERSION = "12"`      |

### Toolchain Version Classification

To prevent ambiguity and avoid overclaiming compatibility across unverified version ranges, toolchain versions are classified into four distinct levels:

1. **Declared Compatibility Targets**:
   - **Node.js**: Node.js 20.0.0+ (Declared target baseline)
   - **Bun**: Bun 1.0.0+ (Declared target baseline)
   - **npm**: npm 10.0.0+ (Declared target baseline)
   - **pnpm**: pnpm 9.0.0+ (Declared target baseline)
     _(Note: Declared compatibility targets represent target baselines, not a guarantee that every point release in the range is exhaustively exercised in CI.)_
2. **Default Fallback Versions**:
   - The canonical versions selected when no version is specified in workspace files or inputs (Node.js 24, Bun 1.4, npm 12, pnpm 12).
3. **Consumer Override Options**:
   - Explicit version strings supplied via workspace files (`.nvmrc`, `.node-version`, `.bun-version`, `package.json` -> `packageManager` or `devEngines`) or action inputs (e.g. `runtime: 'node@22'`, `runtime: 'bun@1.4'`).
4. **CI Tested Versions**:
   - Versions explicitly exercised in automated CI integration testing (`.github/workflows/test-actions.yml` and test fixtures): Node.js 24 / 24.19.0, Bun 1.4, npm 12 / 11.19.0, pnpm 12 / 11.21.0.

### GitHub Actions Runner Assumptions

- **Runner OS**: `ubuntu-latest` (Linux x64).
- **Shell**: Bash (`shell: bash`).
- **Dependencies**: Uses official setup actions (`actions/setup-node@v7`, `pnpm/setup@v3`, `oven-sh/setup-bun@v2`, `voidzero-dev/setup-vp@v1`, `actions/upload-pages-artifact@v5`, `autofix-ci/action@v1`).

---

## Public Action API Contract & Source of Truth

The public API contract of all composite actions (`astro`, `vite`, `vite-plus`, `lint-format`) is explicitly defined in and derived from each action's `action.yml` file, which serves as the single source of truth:

```
action.yml
   ↓
contract parser / validator (src/action-contract.ts)
   ↓
automated tests (__tests__/action-contract.test.ts)
   ↓
documentation
```

### Public API Action Contract Governance

- **Public Actions**: `astro`, `vite`, `vite-plus`, `lint-format`.
- **Source of Truth**: `action.yml` in each action's directory. No external or redundant source of truth is created.
- **Contract Verification**: Validated programmatically by `parseActionContract` and `validateAllPublicActionContracts` in `src/action-contract.ts`, and enforced in CI via `npm run test:actions`.
- **Breaking API Changes**:
  The following contract changes are strictly classified as breaking API changes and will be flagged by `detectBreakingChanges()`:
  1. Removal of a public input parameter.
  2. Changing an input from optional (`required: false`) to required (`required: true`).
  3. Modifying the default value of an input parameter.
  4. Removal of a public output variable.

## Composite Actions Expectations

Every composite action in this repository shares a common environment resolution engine (`dist/resolve-environment.mjs`) but serves specific deployment or workflow goals.

### Public Action Interfaces

#### `astro` (Astro Site Build and Deploy)

- **Supported Runtimes**: `node` (default), `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Public Inputs**:
  - `path` (optional, default: `"dist"`): Directory where the built site is located.
  - `runtime` (optional): Runtime override string (e.g., `"node@24"`, `"bun@1.4"`).
  - `build-command` (optional): Custom build command string.
- **Public Outputs**:
  - `node-version`: The resolved Node.js version used.
  - `bun-version`: The resolved Bun version used.
  - `package-manager`: The package manager used (`npm`, `pnpm`, `bun`).
  - `package-manager-version`: The version string of the package manager used.
  - `runtime`: The resolved runtime mode (`node` or `bun`).
- **Behavior & Constraints**:
  - Automatically installs dependencies (`npm ci` / `pnpm install --frozen-lockfile` / `bun install --frozen-lockfile`).
  - Executes build command via `dist/build-command.mjs` (defaults to `<package-manager> run build`).
  - Sets GitHub Pages site variables and uploads artifact via `actions/upload-pages-artifact`.

#### `vite` (Vite Site Build and Deploy)

- **Supported Runtimes**: `node` (default), `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Public Inputs**:
  - `path` (optional, default: `"dist"`): Directory where the built site is located.
  - `runtime` (optional): Runtime override string.
  - `build-command` (optional): Custom build command string.
- **Public Outputs**:
  - `node-version`, `bun-version`, `package-manager`, `package-manager-version`, `runtime`.
- **Behavior & Constraints**:
  - Installs dependencies and builds site via `dist/build-command.mjs` (defaults to `<package-manager> run build`).
  - Sets GitHub Pages site variables and uploads artifact via `actions/upload-pages-artifact`.

#### `vite-plus` (Vite+ Site Build and Deploy)

- **Supported Runtimes**: `node` (default), `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Public Inputs**:
  - `path` (optional, default: `"dist"`): Directory where the built site is located.
  - `runtime` (optional): Runtime override string.
  - `build-command` (optional): Custom build command string.
- **Public Outputs**:
  - `node-version`, `bun-version`, `package-manager`, `package-manager-version`, `runtime`.
  - `vp-version`: The version of Vite+ installed by `voidzero-dev/setup-vp`.
- **Behavior & Constraints**:
  - Uses `voidzero-dev/setup-vp` for Vite+ toolchain setup and package installation.
  - Defaults build command to `vpr build`.
  - Sets GitHub Pages site variables and uploads artifact via `actions/upload-pages-artifact`.

#### `lint-format` (Lint and Format Verification)

- **Supported Runtimes**: `node` (default), `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Public Inputs**:
  - `runtime` (optional): Runtime override string.
- **Public Outputs**:
  - `node-version`, `bun-version`, `package-manager`, `package-manager-version`, `runtime`.
- **Behavior & Constraints**:
  - Installs dependencies (`pnpm install --no-frozen-lockfile`, `bun install`, or `npm install`).
  - Executes linting/formatting via `dist/lint-format.mjs`.
  - Triggers `autofix-ci/action` when running in a workflow named `autofix.ci`.

---

## Compatibility Matrix

The matrix below answers: _“If a consumer uses runtime X and package manager Y with action Z, is this combination supported and tested?”_

| Runtime (`runtime`) | Package Manager (`pm`) | `astro`     | `vite`      | `vite-plus` | `lint-format` | CI Coverage Status                                                    |
| ------------------- | ---------------------- | ----------- | ----------- | ----------- | ------------- | --------------------------------------------------------------------- |
| `node`              | `npm`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `node`              | `pnpm`                 | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `node`              | `bun`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `bun`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `pnpm`                 | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `npm`                  | Unsupported | Unsupported | Unsupported | Unsupported   | Not supported (Bun runtime mode requires Bun or pnpm package manager) |

### Runtime & Package Manager Compatibility Contract

The repository defines an explicit, deterministic canonical compatibility model (`CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`) which serves as the single source of truth for runtime and package manager compatibility across all actions and environment resolution routines.

#### Canonical Compatibility Model Architecture

The canonical compatibility model explicitly defines:

- **Supported Runtimes**: `node`, `bun`
- **Supported Package Managers**: `npm`, `pnpm`, `bun`
- **Supported Combinations**:
  - `node` + `npm` (supported, default fallback combination)
  - `node` + `pnpm` (supported)
  - `node` + `bun` (supported)
  - `bun` + `pnpm` (supported)
  - `bun` + `bun` (supported)
- **Explicitly Unsupported Combinations**:
  - `bun` + `npm` (rejected: Bun runtime does not support npm package manager)

All compatibility type guards (`isSupportedRuntime`, `isSupportedPackageManager`), resolution checks (`getCombinationCompatibility`), and resolution validation routines (`validateRuntimePackageManagerCompatibility`) derive their behavior directly from this single canonical model.

#### Supported Combinations

- **Node + npm** (`node` runtime + `npm` package manager): Supported (Default fallback combination).
- **Node + pnpm** (`node` runtime + `pnpm` package manager): Supported.
- **Node + Bun** (`node` runtime + `bun` package manager): Supported (Bun used as package manager under Node.js runtime).
- **Bun + Bun** (`bun` runtime + `bun` package manager): Supported (Default runtime when `bun` package manager is detected).
- **Bun + pnpm** (`bun` runtime + `pnpm` package manager): Supported (Bun runtime with `pnpm` package manager).

#### Invalid & Unsupported Combinations

- **Bun + npm** (`bun` runtime + `npm` package manager): Unsupported. Bun runtime requires Bun or pnpm package manager.
- **Unrecognized Runtimes or Package Managers**: Any runtime other than `node` or `bun`, or package manager other than `npm`, `pnpm`, or `bun`, is unsupported.

#### Explicit Runtime Precedence

Runtime resolution follows strict precedence rules:

1. **Explicit Action Input**: An explicit `runtime` input (e.g. `node` or `bun`) takes top priority.
2. **Package Manager Inference**: If no explicit runtime is provided, detecting `bun` package manager resolves runtime to `bun`.
3. **Fallback Default**: Defaults to `node` runtime if no explicit runtime input is provided and package manager is `npm` or `pnpm`.

**Critical Invariant**: Explicit runtime selections are never silently overridden by package-manager detection. Invalid runtime/package-manager combinations fail validation explicitly during environment resolution rather than being silently transformed into another runtime.

#### Explicit Runtime Input Contract & Validation

Action runtime inputs (`runtime`) are validated against an explicit input grammar:

- **Accepted Syntax**:
  - `node` or `node@<version>` (e.g. `node@24`, `node@20.11.0`)
  - `bun` or `bun@<version>` (e.g. `bun@1.4`, `bun@1.1.20`)
  - Multi-runtime combinations: comma or space-separated specifiers (e.g. `node@24,bun@1.4`)
  - `both` keyword (enables Bun versioning while defaulting runtime mode to Node)
- **Automatic Runtime Detection**: When no explicit runtime input is supplied (omitted, empty, or whitespace-only), runtime resolution proceeds to automatic project detection.
- **Fail-Fast Validation**: Malformed syntax (e.g. `node@`, `,node`, `node@@24`), unknown runtime names (e.g. `deno`), partial prefix matches (e.g. `nodedev`, `bunyan`), or duplicate/conflicting specifiers fail fast with an actionable error and are never silently ignored or converted.

#### Extended Compatibility CI Execution & Verification

Automated CI testing in `.github/workflows/test-actions.yml` executes real fixture-based workflows for every supported combination defined in `CANONICAL_COMPATIBILITY_MODEL`:

1. **Matrix Mapping**: Every supported runtime and package manager combination maps deterministically to fixture directories under `__tests__/fixtures/${action}/${runtime}/${pm}/${type}`.
2. **Environment & Toolchain Setup**: CI sets up the exact target runtime (`Node.js` or `Bun`) and package manager (`npm`, `pnpm`, or `bun`) based on environment resolution.
3. **Execution Verification**:
   - Package manager dependency installation is executed (`npm ci`, `pnpm install`, or `bun install`).
   - Action build scripts (`astro`, `vite`, `vite-plus`) or verification scripts (`lint-format`) are executed.
   - Outputs (`package-manager`, `runtime`, `SITE`, `BASE`) and generated build artifacts (`dist/index.html`) are verified against contract assertions.
4. **Diagnostic Failures**: Any mismatch between expected and detected runtime/package-manager, missing canonical matrix combinations, or missing build output artifacts triggers explicit CI failures with detailed failure stage and fixture path context.

---

## Generated Artifact Integrity Contract & Build Policy

To ensure all composite actions run reliable, verified, and tamper-proof runtime code, generated artifacts in `dist/` are strictly governed by this artifact integrity contract:

### Single Source of Truth

- **Source Files (`src/`)**: All implementation logic resides exclusively in TypeScript files under `src/` (e.g. `src/resolve-environment.ts`, `src/lint-format.ts`, `src/site-variables.ts`, `src/build-command.ts`, `src/compatibility.ts`, `src/setup-adapters.ts`).
- **Generated Output (`dist/`)**: The `dist/` directory is a generated-only build target containing bundled ES modules (`.mjs`). No production logic may exist solely in `dist/` without corresponding source in `src/`.
- **Manual Edit Prohibition**: Direct manual edits to `dist/` files are strictly prohibited. Any change to `dist/` must strictly be the deterministic result of running the official build command from source.

### Official Build Pipeline

- **Build Command**: `npm run build` (invokes `vp pack`).
- **Entry Configuration**: Defined in `vite.config.ts`, mapping `src/${name}.ts` source entrypoints to `dist/${name}.mjs` output files.
- **Deterministic Output**: Bundled artifacts are deterministic. Rebuilding from unchanged source files yields identical output without working tree drift.

### Automated Integrity Verification & CI Enforcement

- **Automated Verification Sequence**: Clean checkout → Install dependencies → Execute build → Verify working tree cleanliness (`git diff --exit-code dist/` and `git status --porcelain dist/`).
- **CI Enforcement**: Automated CI workflows (`.github/workflows/ci.yml`) and unit tests (`__tests__/artifact-integrity.test.ts`) validate that:
  1. All expected entrypoint artifacts exist in `dist/`.
  2. Artifacts in `dist/` match fresh build output from `src/`.
  3. Stale, missing, or manually modified artifacts trigger explicit build/test failures with actionable resolution instructions.

---

## Error Contract & Failure Semantics

To ensure predictable behavior across composite actions, environment resolution, and execution pipelines, `@area44/workflows` formalizes a consistent, deterministic error contract.

### Fail Fast & Structured Error Categories

All workflow errors derive from `WorkflowError` (`src/errors.ts`) and contain a specific `code` (`WorkflowErrorCode`), a human-readable `message`, and optional structured `context` (`action`, `stage`, `resource`, `path`, `cause`).

| Error Code                  | Failure Category                   | Description & Representative Cause                                                                                                                                                           |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`             | User Action Input                  | Fail fast when user inputs are malformed, duplicate, or invalid. Examples: `runtime: "node@"`, `runtime: "node,,bun"`, `runtime: "node, node@24"`, or unterminated quotes in build commands. |
| `UNSUPPORTED_RUNTIME_OR_PM` | Runtime / Toolchain Name           | Fail fast when an unrecognized runtime or package manager name is provided or detected (e.g. `deno`, `yarn`).                                                                                |
| `UNSUPPORTED_COMBINATION`   | Compatibility Matrix               | Derived directly from `CANONICAL_COMPATIBILITY_MODEL`. Fail fast when runtime and package manager combination is unsupported (e.g. Bun runtime with `npm` package manager).                  |
| `MISSING_CONFIGURATION`     | Workspace / Fixture Configuration  | Missing required workspace files or fixture metadata (e.g. missing `package.json`, missing fixture directory, missing entry source files).                                                   |
| `SETUP_FAILURE`             | Toolchain / Environment Resolution | Failures during toolchain/environment resolution or setup adapter output generation.                                                                                                         |
| `COMMAND_EXECUTION_FAILURE` | Command Execution                  | Failures during shell command or script execution (e.g. failed `npm run build`, failed `check`/`lint`/`format` scripts). Errors are never swallowed or converted to success.                 |

### Single Source of Compatibility Truth

The error contract does **not** maintain a secondary or duplicated compatibility matrix. All compatibility decisions remain strictly bound to `CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`.

---

## Lightweight Release & Toolchain Upgrade Policy

To prevent silent compatibility regressions and manage toolchain upgrades predictably, changes to defaults or supported environments must follow this release policy.

### Evaluating Toolchain Upgrades

When upgrading default versions (e.g. Node.js 24 → 26, Bun 1.4 → 1.5, pnpm 12 → 13, npm 12 → 13):

1. **Verify Minimum Runner Support**: Ensure GitHub Actions `ubuntu-latest` runners and setup actions support the new version natively.
2. **Update Implementation Constants**: Update default version constants in `src/resolve-environment.ts`.
3. **Rebuild Dist Artifacts**: Run `npm run build` to regenerate `dist/resolve-environment.mjs`.
4. **Update Documentation**: Update canonical version references in `COMPATIBILITY.md` and `README.md`.
5. **Update CI Matrix & Test Fixtures**: Ensure unit tests in `__tests__/resolve-environment.test.ts` and compatibility tests pass with updated defaults.

### Protection Against Silent Breaking Changes

- Public action inputs and outputs must not be removed or renamed without a major version bump.
- Default fallback version changes must be clearly documented in pull requests and release notes.
- Consumer explicit overrides (via `.nvmrc`, `packageManager`, or `runtime` input) always take precedence over default version changes, ensuring existing projects with locked versions remain unaffected.
