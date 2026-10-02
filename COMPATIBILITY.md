# Compatibility Contract and Release Policy

This document defines the compatibility contract, runtime and toolchain guarantees, composite action expectations, compatibility matrix, and release policy for `@area44/workflows`. For specialized operational guides, see the [Documentation Index](./README.md#documentation-architecture).

---

## Supported Runtime & Toolchain Versions

The repository's environment resolution (`src/resolve-environment.ts`) automatically discovers project settings or falls back to specified default versions. For complete matrix details, see **[Detailed Toolchain Matrix](./docs/compatibility.md)**.

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

---

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

| Runtime | Package Manager | Status      | Default | Reason / Notes                                        |
| ------- | --------------- | ----------- | ------- | ----------------------------------------------------- |
| `node`  | `npm`           | Supported   | Yes     | Default fallback combination                          |
| `node`  | `pnpm`          | Supported   | No      |                                                       |
| `node`  | `bun`           | Supported   | No      |                                                       |
| `bun`   | `bun`           | Supported   | No      |                                                       |
| `bun`   | `pnpm`          | Supported   | No      |                                                       |
| `bun`   | `npm`           | Unsupported | No      | Bun runtime mode requires Bun or pnpm package manager |

### Runtime & Package Manager Compatibility Contract

The repository defines an explicit, deterministic canonical compatibility model (`CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`) which serves as the single source of truth for runtime and package manager compatibility across all actions and environment resolution routines. See **[Detailed Toolchain Matrix](./docs/compatibility.md)**.

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

---

## Generated Artifact Integrity Contract & Build Policy

To ensure all composite actions run reliable, verified, and tamper-proof runtime code, generated artifacts in `dist/` are strictly governed by this artifact integrity contract. See **[Artifact Integrity](./docs/artifacts.md)**.

### Single Source of Truth

- **Source Files (`src/`)**: All implementation logic resides exclusively in TypeScript files under `src/`.
- **Generated Output (`dist/`)**: The `dist/` directory is a mandatory, git-tracked generated build target containing bundled ES modules (`.mjs`). No production logic may exist solely in `dist/` without corresponding source in `src/`.
- **Manual Edit Prohibition**: Direct manual edits to `dist/` files are strictly prohibited.

---

## Error Contract & Failure Semantics

To ensure predictable behavior across composite actions, environment resolution, and execution pipelines, `@area44/workflows` formalizes a consistent, deterministic error contract. See **[Error Contract Guide](./docs/errors.md)**.

### Fail Fast & Structured Error Categories

All workflow errors derive from `WorkflowError` (`src/errors.ts`) and contain a specific `code` (`WorkflowErrorCode`), a human-readable `message`, and optional structured `context`.

| Error Code                  | Failure Category                   | Description & Representative Cause                                                                                     |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`             | User Action Input                  | Fail fast when user inputs are malformed, duplicate, or invalid.                                                       |
| `UNSUPPORTED_RUNTIME_OR_PM` | Runtime / Toolchain Name           | Fail fast when an unrecognized runtime or package manager name is provided or detected.                                |
| `UNSUPPORTED_COMBINATION`   | Compatibility Matrix               | Derived directly from `CANONICAL_COMPATIBILITY_MODEL`. Fail fast when combination is unsupported (e.g. `bun` + `npm`). |
| `MISSING_CONFIGURATION`     | Workspace / Fixture Configuration  | Missing required workspace files or fixture metadata.                                                                  |
| `SETUP_FAILURE`             | Toolchain / Environment Resolution | Failures during toolchain/environment resolution or setup adapter output generation.                                   |
| `COMMAND_EXECUTION_FAILURE` | Command Execution                  | Failures during shell command or script execution. Errors are never swallowed.                                         |

---

## Security Boundaries & Invariants

This section formalizes the security architecture, input trust boundaries, execution constraints, credential sanitization rules, and operational invariants enforced across `@area44/workflows`. See **[Security Boundaries Guide](./docs/security.md)**.

### Trust Boundaries & Control Planes

- **User-Controlled Inputs**: Parsed and validated by `parseEnvironmentInputs()`. Malformed input fails fast with `INVALID_INPUT` or `UNSUPPORTED_RUNTIME_OR_PM`.
- **Command & Script Execution Boundary**: Executed via custom tokenizer without passing through a shell subshell (`sh -c`).
- **Credential Sanitization**: `sanitizeCommandString()` masks URLs with credentials, sensitive CLI flags, and token patterns.

---

## Lightweight Release & Toolchain Upgrade Policy

To prevent silent compatibility regressions and manage toolchain upgrades predictably, changes to defaults or supported environments must follow this release policy.

---

## Versioning Model

The versioning model formalizes how repository versions are determined and what constitutes a version-impacting change. See **[Versioning Model Guide](./docs/versioning.md)**.

### Authoritative Version Source

- **Single Source of Truth**: The `version` property in `package.json` is the single authoritative source of truth for the repository version.
- **Lockfile Synchronization**: `package-lock.json` (`version` property) must remain in exact synchronization with `package.json`.
- **Programmatic Validation**: Machine-verifiable version retrieval and validation are implemented in `src/versioning.ts` (`getRepositoryVersion`, `validateRepositoryVersion`, `runVersionVerification`) and enforced in CI via `npm run verify:version`.

---

## Upgrade Guardrails

To prevent accidental breaking changes and compatibility regressions when modifying repository contracts or upgrading dependencies, machine-verifiable upgrade guardrails are enforced via `src/upgrade-guardrails.ts` and `npm run verify:upgrade`. See **[Upgrade Guardrails Guide](./docs/upgrade-guardrails.md)**.
