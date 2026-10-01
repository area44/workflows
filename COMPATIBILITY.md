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

- **Source Files (`src/`)**: All implementation logic resides exclusively in TypeScript files under `src/` (e.g. `src/resolve-environment.ts`, `src/lint-format.ts`, `src/site-variables.ts`, `src/build-command.ts`, `src/compatibility.ts`, `src/setup-adapters.ts`, `src/artifact-integrity.ts`).
- **Generated Output (`dist/`)**: The `dist/` directory is a mandatory, git-tracked generated build target containing bundled ES modules (`.mjs`). No production logic may exist solely in `dist/` without corresponding source in `src/`.
- **Manual Edit Prohibition**: Direct manual edits to `dist/` files are strictly prohibited. Any change to `dist/` must strictly be the deterministic result of running the official build command from source.

### Release Artifact Contract & Consumer Entry Points

- **Release Artifact Set**: The required release artifacts (`dist/resolve-environment.mjs`, `dist/lint-format.mjs`, `dist/site-variables.mjs`, `dist/build-command.mjs`) are derived programmatically from `vite.config.ts`.
- **Consumer Action Entry Points**: Public composite actions (`astro`, `vite`, `vite-plus`, `lint-format`) reference generated artifacts via `$ACTION_PATH/../dist/<entrypoint>.mjs`.
- **Source to Release Relationship**:
  ```
  Source (src/)
    ↓
  Build (npm run build)
    ↓
  Generated dist/
    ↓
  Artifact Verification (npm run verify:artifacts)
    ↓
  Release / Publish
  ```

### Official Build Pipeline & Release Integrity Sequence

- **Build Command**: `npm run build` (invokes `vp pack`).
- **Entry Configuration**: Defined in `vite.config.ts`, mapping `src/${name}.ts` source entrypoints to `dist/${name}.mjs` output files.
- **Deterministic Output**: Bundled artifacts are deterministic. Rebuilding from unchanged source files yields identical output without working tree drift.
- **Verification Engine**: Verification is powered by `src/artifact-integrity.ts` (`verifyArtifactIntegrity` and `runArtifactVerification`).
- **Required Release Sequence**:
  The repository release integrity contract defines the required release sequence:
  ```
  checkout
    ↓
  install dependencies
    ↓
  build (npm run build)
    ↓
  verify generated artifacts (npm run verify:artifacts)
    ↓
  run tests / validation (npm test)
    ↓
  publish / release
  ```
- **Fail-Fast Verification Rules**:
  - Missing `dist/` directory or expected `.mjs` artifacts.
  - Empty (0-byte) generated artifact files.
  - Unexpected or untracked extra files in `dist/`.
  - Stale artifacts where committed `dist/` is out of sync with current `src/` source (detected by rebuilding and checking `git status --porcelain -- dist/`).
  - Build command failure.

### Release Metadata & Artifact Synchronization

- **Release Version**: Release versioning is tied to `package.json` (`version`).
- **Source-to-Artifact Integrity**: Build execution regenerates `dist/` directly from current checked-out source files. Running `git status --porcelain -- dist/` verifies that the committed `dist/` directory remains in exact synchronization with source code without generated artifact drift.

### Automated Integrity Verification & CI Enforcement

- **Automated Verification Sequence**:
  ```
  checkout
    ↓
  install dependencies
    ↓
  build (npm run build)
    ↓
  verify generated artifacts (npm run verify:artifacts)
    ↓
  run tests / validation (npm test)
    ↓
  publish / release
  ```
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

## Security Boundaries & Invariants

This section formalizes the security architecture, input trust boundaries, execution constraints, credential sanitization rules, and operational invariants enforced across `@area44/workflows`.

### Trust Boundaries & Control Planes

The repository delineates distinct boundaries between user-supplied input, environment detection, and execution context:

- **User-Controlled Inputs**:
  - Composite action inputs (`runtime`, `build-command`, `path` in `action.yml`) are untrusted inputs supplied by workflow authors.
  - Workspace configuration files (`package.json`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles) are read from the checkout root.
  - Environment inputs are parsed and strictly validated by `parseEnvironmentInputs()` in `src/resolve-environment.ts`. Any malformed input (e.g., unterminated quotes, duplicate specifiers, unrecognized tool names) fails fast with `INVALID_INPUT` or `UNSUPPORTED_RUNTIME_OR_PM` before tool setup or build execution occurs.
- **Environment & Runtime Selection**:
  - Toolchain selection (Node.js version, Bun version, package manager) is computed deterministically by environment resolution pipeline functions.
  - Resolution precedence is strictly enforced: explicit action input > package manager inference > fallback defaults.
  - Selected runtime/package manager combinations are strictly cross-checked against `CANONICAL_COMPATIBILITY_MODEL`. Unsupported combinations (e.g., Bun runtime with npm package manager) trigger fail-fast error `UNSUPPORTED_COMBINATION`.
- **Command & Script Execution Boundary**:
  - `src/build-command.ts` parses and tokenizes `build-command` strings using a custom tokenizer without passing commands to a shell subshell (e.g. `sh -c` or `bash -c`). Arguments are passed directly as array arguments to `@actions/exec` (`exec.exec(command, args)`).
  - Shell expansion metacharacters (`;`, `&&`, `|`, `$VAR`, `>`) are treated as literal argument values, preventing shell injection through custom build command strings.
  - `src/lint-format.ts` sanitizes package manager names via `sanitizePackageManager()` (enforcing alphanumeric/hyphen characters) before running script hooks (`check`, `lint`, `format`, `fmt`).
- **Filesystem Access Boundary**:
  - Read-only inspection is limited to workspace setup files (`package.json`, `.nvmrc`, `.node-version`, `.bun-version`, lockfiles, `vite.config.ts`).
  - Write access is restricted to generated output directories (e.g. `dist/` or user-specified site path) and temporary fixture setup during CI matrix execution.
- **Source vs Generated Artifact Trust Boundary**:
  - TypeScript files in `src/` are the single source of truth for execution logic.
  - Generated files in `dist/` are build targets and are never treated as hand-editable source code.
  - Source-to-artifact synchronization is enforced in CI via `npm run verify:artifacts` (`src/artifact-integrity.ts`). Direct edits to `dist/` trigger build failure.

### Credential & Token Sanitization Invariants

To prevent accidental leakages of credentials, access tokens, or sensitive URLs in logs, outputs, and exception context:

- `sanitizeCommandString()` in `src/build-command.ts` masks sensitive patterns before logging or attaching to error context:
  - URLs containing authentication credentials (e.g., `https://user:pass@host` -> `https://***:***@host`).
  - Sensitive CLI flags (e.g., `--token=secret`, `--key secret`, `--api-key secret`, `--pat secret` -> `--token=***`).
  - Common access token patterns (GitHub PATs `ghp_...`, `github_pat_...`, npm tokens `npm_...`, Slack tokens `xox...`).
- Error messages and `WorkflowError` context objects attached to setFailed or throw statements must never contain unmasked tokens or sensitive URLs.

### Error Handling & Execution Invariants

- **No Silent Failure Suppression**:
  - Non-zero exit codes from build commands or script failures are never swallowed or converted to success.
  - Failures trigger `core.setFailed()` with structured `WorkflowError` instances (`COMMAND_EXECUTION_FAILURE`) and terminate execution with non-zero exit codes.
- **Preservation of Error Contracts**:
  - Error categories (`INVALID_INPUT`, `UNSUPPORTED_RUNTIME_OR_PM`, `UNSUPPORTED_COMBINATION`, `MISSING_CONFIGURATION`, `SETUP_FAILURE`, `COMMAND_EXECUTION_FAILURE`) are consistently preserved throughout the pipeline.
- **Compatibility Single Source of Truth**:
  - Compatibility decisions derive exclusively from `CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`. No secondary matrices exist.

### CI & Test Fixture Security Assumptions

- Automated CI workflows (`.github/workflows/ci.yml`, `test-actions.yml`, `autofix.yml`) run on standard GitHub-hosted `ubuntu-latest` runners in isolated containers/VMs.
- Test matrix entries map deterministically to fixture directories in `__tests__/fixtures/`. Fixture directories are treated as isolated project workspaces and cannot escape their workspace root.

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

---

## Versioning Model

The versioning model formalizes how repository versions are determined and what constitutes a version-impacting change across package versions, public action behaviors, generated `dist/` artifacts, and compatibility models.

### Authoritative Version Source

- **Single Source of Truth**: The `version` property in `package.json` is the single authoritative source of truth for the repository version.
- **Lockfile Synchronization**: `package-lock.json` (`version` property) must remain in exact synchronization with `package.json`.
- **No Duplicate Declarations**: No manually maintained parallel version files, independent source constants, or hard-coded action versions exist.
- **Programmatic Validation**: Machine-verifiable version retrieval and validation are implemented in `src/versioning.ts` (`getRepositoryVersion`, `validateRepositoryVersion`).

### SemVer Interpretation

Repository versioning strictly adheres to Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`), validated programmatically via `parseSemVer()` and `isValidSemVer()`.

### Change Classification Rules

Changes are deterministically classified into SemVer impact categories using `classifyChangeImpact()` in `src/versioning.ts`:

#### Patch-Level Changes

Patch releases represent non-breaking fixes and non-functional changes:

- Internal implementation bug fixes or error handling refinements.
- Documentation updates that do not alter execution behavior or action contracts.
- Internal refactoring preserving public action interfaces (`action.yml`) and compatibility models.

#### Minor-Level Changes

Minor releases introduce backward-compatible capabilities:

- Addition of new optional public action inputs (`required: false`) in `action.yml`.
- Addition of new public action outputs in `action.yml`.
- Newly supported runtime or package manager matrix combinations added to `CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`.
- Backward-compatible internal features or tooling enhancements.

#### Major-Level Changes

Major releases contain breaking API or compatibility changes:

- Removal of public action inputs or outputs from `action.yml`.
- Modifying a public action input from optional (`required: false`) to required (`required: true`).
- Changing default values of public action inputs.
- Removal or deprecation of supported runtime or package manager combinations in `CANONICAL_COMPATIBILITY_MODEL`.
- Any backward-incompatible behavioral change violating an existing public API or error contract.

### Integration with Existing Contracts

The versioning model references existing sources of truth without duplication:

- **Public Action API**: Derived directly from `action.yml` files, parsed by `src/action-contract.ts`. Breaking API changes are flagged by `detectBreakingChanges()`.
- **Compatibility Model**: Bound strictly to `CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`.
- **Artifact Integrity**: Governed by `src/artifact-integrity.ts`. Releases require rebuilding `dist/` (`npm run build`) and confirming artifact synchronization (`npm run verify:artifacts`).

### Scope Boundaries & Non-Automated Behavior

The versioning model formalizes version determination and classification rules. It explicitly does not automate:

- Automatic dependency upgrade guardrails.
- Automated release publishing or GitHub Release creation.
- Release tag creation or git workflow tagging automation.
- Automated changelog generation.
- Provenance tracking infrastructure or `GITHUB_SHA` release metadata.
