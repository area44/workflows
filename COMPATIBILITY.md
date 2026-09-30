# Compatibility Contract and Release Policy

This document defines the compatibility contract, runtime and toolchain guarantees, composite action expectations, compatibility matrix, and release policy for `@area44/workflows`.

---

## 1. Supported Runtime & Toolchain Versions

The repository's environment detection (`src/detect-env.ts`) automatically discovers project settings or falls back to specified default versions.

### Canonical Default Versions

When a project does not specify a toolchain version in repository configuration files or workflow inputs, the action selects these canonical default versions:

| Toolchain | Default Version Constant | Default Value | Source Constant in `src/detect-env.ts`     |
| --------- | ------------------------ | ------------- | ------------------------------------------ |
| Node.js   | `DEFAULT_NODE_VERSION`   | `"24"`        | `export const DEFAULT_NODE_VERSION = "24"` |
| Bun       | `DEFAULT_BUN_VERSION`    | `"1.4"`       | `export const DEFAULT_BUN_VERSION = "1.4"` |
| npm       | `DEFAULT_NPM_VERSION`    | `"12"`        | `export const DEFAULT_NPM_VERSION = "12"`  |
| pnpm      | `DEFAULT_PNPM_VERSION`   | `"12"`        | `export const DEFAULT_PNPM_VERSION = "12"` |

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

## 2. Composite Actions Expectations

Every composite action in this repository shares a common environment detection engine (`dist/detect-env.mjs`) but serves specific deployment or workflow goals.

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

## 3. Compatibility Matrix

The matrix below answers: _“If a consumer uses runtime X and package manager Y with action Z, is this combination supported and tested?”_

| Runtime (`runtime`) | Package Manager (`pm`) | `astro`     | `vite`      | `vite-plus` | `lint-format` | CI Coverage Status                                                    |
| ------------------- | ---------------------- | ----------- | ----------- | ----------- | ------------- | --------------------------------------------------------------------- |
| `node`              | `npm`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `node`              | `pnpm`                 | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `node`              | `bun`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `bun`                  | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `pnpm`                 | Supported   | Supported   | Supported   | Supported     | Tested in CI (`test-actions.yml`)                                     |
| `bun`               | `npm`                  | Unsupported | Unsupported | Unsupported | Unsupported   | Not supported (Bun runtime mode requires Bun or pnpm package manager) |

---

## 4. Lightweight Release & Toolchain Upgrade Policy

To prevent silent compatibility regressions and manage toolchain upgrades predictably, changes to defaults or supported environments must follow this release policy.

### Evaluating Toolchain Upgrades

When upgrading default versions (e.g. Node.js 24 → 26, Bun 1.4 → 1.5, pnpm 12 → 13, npm 12 → 13):

1. **Verify Minimum Runner Support**: Ensure GitHub Actions `ubuntu-latest` runners and setup actions support the new version natively.
2. **Update Implementation Constants**: Update default version constants in `src/detect-env.ts`.
3. **Rebuild Dist Artifacts**: Run `npm run build` to regenerate `dist/detect-env.mjs`.
4. **Update Documentation**: Update canonical version references in `COMPATIBILITY.md` and `README.md`.
5. **Update CI Matrix & Test Fixtures**: Ensure unit tests in `__tests__/detect-env.test.ts` and compatibility tests pass with updated defaults.

### Protection Against Silent Breaking Changes

- Public action inputs and outputs must not be removed or renamed without a major version bump.
- Default fallback version changes must be clearly documented in pull requests and release notes.
- Consumer explicit overrides (via `.nvmrc`, `packageManager`, or `runtime` input) always take precedence over default version changes, ensuring existing projects with locked versions remain unaffected.
