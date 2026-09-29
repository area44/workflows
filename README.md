# area44/workflows

This repository contains reusable **GitHub Actions workflows and composite actions** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects.

## Composite Actions

- **[Astro](./astro/README.md)**: Build and deploy Astro sites.
- **[Vite](./vite/README.md)**: Build and deploy Vite sites.
- **[Vite+](./vite-plus/README.md)**: Build and deploy Vite+ sites.
- **[Lint/Format](./lint-format/README.md)**: Run lint/format scripts.

## Environment Contract

Environment detection is executed by `src/detect-env.ts` and shared across composite actions (`astro`, `vite`, `vite-plus`, `lint-format`).

### Output Contract

The `detectEnv()` function resolves workspace configuration and writes the following step outputs:

| Output Name               | Type                           | Description                                                                                                                | Example Values                         |
| ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `runtime`                 | `"node"` \| `"bun"`            | The resolved runtime environment.                                                                                          | `"node"`, `"bun"`                      |
| `node-version`            | `string`                       | The resolved Node.js version (empty string if Bun runtime without explicit Node.js version).                               | `"24"`, `"22.0.0"`, `""`               |
| `bun-version`             | `string`                       | The resolved Bun version (empty string if Bun is neither requested nor detected).                                          | `"1.4"`, `"1.1.20"`, `""`              |
| `package-manager`         | `"npm"` \| `"pnpm"` \| `"bun"` | The resolved package manager name.                                                                                         | `"npm"`, `"pnpm"`, `"bun"`             |
| `package-manager-version` | `string`                       | The resolved package manager version string.                                                                               | `"12"`, `"11.21.0"`, `"1.4"`           |
| `pnpm-runtime`            | `string`                       | Specialized adapter output for `pnpm/setup` (`bun@<ver>`, `node@<ver>`, or `node@lts`), not a generic runtime abstraction. | `"node@24"`, `"bun@1.4"`, `"node@lts"` |

### Workspace Detection Precedence

Individual detector functions discover settings from project configuration files in the workspace:

#### Package Manager Detector (`detectPackageManager`)

1. `package.json` -> `packageManager` field (e.g., `"pnpm@11.21.0"`, `"bun"`, or `"npm"`). If the version tag is omitted, uses the fallback default for that package manager.
2. `package.json` -> `devEngines`:
   - `devEngines.packageManager`: Supports string (`"pnpm@11.21.0"`), object (`{ "name": "pnpm", "version": "11.21.0" }`), or array (evaluates the first element).
   - `devEngines[pm]`: Evaluates `devEngines.pnpm`, `devEngines.npm`, and `devEngines.bun` in that exact order (string or object `{ "version": "..." }`).
3. **Lockfiles** (evaluated in exact order if `package.json` provides no package manager configuration):
   1. `pnpm-lock.yaml` -> `pnpm@12`
   2. `package-lock.json` -> `npm@12`
   3. `bun.lock` or `bun.lockb` -> `bun@1.4`
4. **Fallback Default**: `npm@12`.

#### Node.js Version Detector (`detectNodeVersion`)

1. `.nvmrc` file content (trimmed).
2. `.node-version` file content (trimmed).
3. `package.json` -> `devEngines`:
   - `devEngines.runtime`: String, object, or array element with `name: "node"` or starting with `"node"` (e.g. `"node@20"`).
   - `devEngines.node`: String or object `{ "version": "..." }`.
4. **Fallback Default**:
   - Empty string (`""`) if package manager context is `bun` and no Node.js configuration (`.nvmrc`, `.node-version`, or `devEngines` for Node.js) exists.
   - `"24"` otherwise.

#### Bun Version Detector (`detectBunVersion`)

1. `.bun-version` file content (trimmed).
2. Package Manager Version: Uses `pm.version` if the detected package manager is `bun` and version is not `"latest"`.
3. `package.json` -> `devEngines`:
   - `devEngines.runtime`: String, object, or array element with `name: "bun"` or starting with `"bun"` (e.g. `"bun@1.4"`).
   - `devEngines.bun`: String or object `{ "version": "..." }`.
4. **Auto-detection Fallback**: `"1.4"` if Bun is detected via lockfile (`bun.lock` or `bun.lockb`), package manager `bun`, or Bun `devEngines`.
5. **Fallback Default**: Empty string (`""`) if Bun is neither requested nor detected.

### Final Resolution Precedence (`detectEnv`)

The `detectEnv()` entrypoint merges explicit `runtime` action inputs with workspace-detected values:

1. **Input Token Parsing**:
   - Parses tokens from the explicit `runtime` action input string (split by whitespace or comma).
   - `both`: Requests Bun setup alongside Node.js, defaulting Bun version to `"1.4"` if no explicit Bun version is attached.
   - First token starting with `"node"` or `"bun"` sets the primary resolved `runtime` (`"node"` or `"bun"`).
   - Extracts explicit version tags if present (e.g. `node@22` sets explicit Node.js version `"22"`, `bun@1.4` sets explicit Bun version `"1.4"`).
2. **Package Manager Resolution**: Calls `detectPackageManager()`.
3. **Bun Version Resolution**: Uses explicit `bunVersion` from `runtime` input if provided (or `"1.4"` if `both` or `bun` without version tag was passed in input); otherwise uses detected Bun version from `detectBunVersion()`.
4. **Runtime Choice Resolution**:
   - Uses explicit `specifiedRuntime` from `runtime` action input if provided.
   - Else uses `"bun"` if detected package manager is `bun`.
   - Else defaults to `"node"`.
5. **Node.js Version Resolution**:
   - Uses explicit `nodeVersion` from `runtime` action input if provided.
   - Else if primary resolved `runtime` is `"bun"`, resolves `node-version` output to empty string (`""`).
   - Else uses detected Node.js version from `detectNodeVersion()`.

### Default Fallback Versions

- **Node.js**: `"24"` (`DEFAULT_NODE_VERSION`)
- **Bun**: `"1.4"` (`DEFAULT_BUN_VERSION`)
- **npm**: `"12"` (`DEFAULT_NPM_VERSION`)
- **pnpm**: `"12"` (`DEFAULT_PNPM_VERSION`)

## License

This project is licensed under the [MIT License](LICENSE).
