# area44/workflows

This repository contains reusable **GitHub Actions workflows and composite actions** for the AREA44 ecosystem. It helps standardize and streamline CI/CD processes across projects.

## Composite Actions

- **[Astro](./astro/README.md)**: Build and deploy Astro sites.
- **[Vite](./vite/README.md)**: Build and deploy Vite sites.
- **[Vite+](./vite-plus/README.md)**: Build and deploy Vite+ sites.
- **[Lint/Format](./lint-format/README.md)**: Run lint/format scripts.

## Environment Contract

Environment detection is handled by `src/detect-env.ts` and shared across composite actions (`astro`, `vite`, `vite-plus`, `lint-format`).

### Produced Action Outputs

| Name                      | Description                                                              | Example Values               |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `runtime`                 | Resolved runtime environment (`"node"` or `"bun"`).                      | `"node"`, `"bun"`            |
| `node-version`            | Target Node.js version (empty string if Bun runtime without Node input). | `"24"`, `"22.0.0"`, `""`     |
| `bun-version`             | Target Bun version (empty string if Bun is not requested or detected).   | `"1.4"`, `"1.1.20"`, `""`    |
| `package-manager`         | Resolved package manager (`"npm"`, `"pnpm"`, or `"bun"`).                | `"npm"`, `"pnpm"`, `"bun"`   |
| `package-manager-version` | Resolved package manager version.                                        | `"12"`, `"11.21.0"`, `"1.4"` |

### Authoritative Detection Precedence

#### 1. Runtime Determination (`runtime`)

1. **Explicit `runtime` input**: The first specified runtime token (`node` or `bun`) in the `runtime` action input string (e.g. `node@24`, `bun@1.4`).
2. **Package Manager**: Defaults to `bun` if the detected package manager is `bun`.
3. **Fallback Default**: `node`.

#### 2. Package Manager Detection (`package-manager` & `package-manager-version`)

1. `package.json.packageManager` field (e.g., `"pnpm@11.21.0"` or `"bun"`). If no version tag is supplied, defaults to the standard version for that package manager.
2. `package.json.devEngines`:
   - `devEngines.packageManager`: Supports string (`"pnpm@11.21.0"`), object (`{ "name": "pnpm", "version": "11.21.0" }`), or array (evaluates first element).
   - `devEngines[pm]`: Evaluates `devEngines.pnpm`, `devEngines.npm`, and `devEngines.bun` in order.
3. **Lockfiles** (evaluated in exact order if `package.json` does not specify a package manager):
   - `pnpm-lock.yaml` -> `pnpm`
   - `package-lock.json` -> `npm`
   - `bun.lock` or `bun.lockb` -> `bun`
4. **Fallback Default**: `npm@12`.

#### 3. Node.js Version Detection (`node-version`)

1. **Explicit `runtime` input**: Version specified in `runtime` input string (e.g. `node@22`).
2. `.nvmrc` file content (trimmed).
3. `.node-version` file content (trimmed).
4. `package.json.devEngines`:
   - `devEngines.runtime`: String, object, or array matching `"node"`.
   - `devEngines.node`: String or object.
5. **Fallback Default**:
   - Empty string (`""`) if runtime resolves to `bun` and no explicit Node version was supplied via `runtime` input.
   - `"24"` if runtime resolves to `node`.

#### 4. Bun Version Detection (`bun-version`)

1. **Explicit `runtime` input**: Version specified in `runtime` input string (e.g. `bun@1.4` or `both`).
2. `.bun-version` file content (trimmed).
3. **Package Manager**: If the detected package manager is `bun` and version is not `"latest"`, uses the package manager version.
4. `package.json.devEngines`:
   - `devEngines.runtime`: String, object, or array matching `"bun"`.
   - `devEngines.bun`: String or object.
5. **Auto-detection Fallback**: If Bun is detected via lockfile (`bun.lock`/`bun.lockb`), package manager `bun`, or `devEngines`, defaults to `"1.4"`.
6. **Fallback Default**: Empty string (`""`) if Bun is neither requested nor detected.

#### Default Versions

- Node.js: `"24"` (`DEFAULT_NODE_VERSION`)
- Bun: `"1.4"` (`DEFAULT_BUN_VERSION`)
- npm: `"12"` (`DEFAULT_NPM_VERSION`)
- pnpm: `"12"` (`DEFAULT_PNPM_VERSION`)

## License

This project is licensed under the [MIT License](LICENSE).
