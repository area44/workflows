# Compatibility Contract

This document defines the compatibility contracts, runtime and toolchain guarantees, supported matrices, and resolution precedence for `@area44/workflows`.

## Canonical Defaults

When project configuration files and workflow inputs do not specify toolchain versions, the resolution engine selects canonical default versions:

- **Node.js**: `"24"` (`DEFAULT_NODE_VERSION`)
- **Bun**: `"1.4"` (`DEFAULT_BUN_VERSION`)
- **npm**: `"12"` (`DEFAULT_NPM_VERSION`)
- **pnpm**: `"12"` (`DEFAULT_PNPM_VERSION`)

## Canonical Compatibility Model

The repository's compatibility contract is governed by `CANONICAL_COMPATIBILITY_MODEL` in `src/compatibility.ts`:

### Supported Runtimes

- `node`
- `bun`

### Supported Package Managers

- `npm`
- `pnpm`
- `bun`

### Supported Matrix Combinations

- `node` + `npm` (Supported, default combination)
- `node` + `pnpm` (Supported)
- `node` + `bun` (Supported)
- `bun` + `bun` (Supported)
- `bun` + `pnpm` (Supported)

### Explicitly Unsupported Combinations

- `bun` + `npm` (Unsupported: Bun runtime mode does not support npm package manager)

## Runtime Resolution Precedence

Environment resolution strictly follows this deterministic precedence chain:

1. **Explicit Action Input**: An explicit `runtime` input (e.g., `node`, `bun`, `node@24`, `bun@1.4`) takes highest priority.
2. **Package Manager Inference**: If no explicit runtime is provided, detecting `bun` package manager resolves runtime to `bun`.
3. **Fallback Default**: Defaults to `node` runtime when package manager is `npm` or `pnpm`.

Explicit runtime selections are never silently converted or overridden. Any unsupported runtime and package manager pairing fails fast during environment resolution with `UNSUPPORTED_COMBINATION`.

## Toolchain Setup Adapters

Resolved environment state is converted to GitHub Actions setup toolchain configurations via adapter functions in `src/setup-adapters.ts`:

- `setupNode`: Computes Node.js setup requirements and caching choices.
- `setupBun`: Computes Bun setup requirements and target version strings.
- `setupPackageManager` & `resolvePnpmSetupRuntime`: Derive specialized setup directives (such as `pnpm/setup` runtime inputs) without re-executing detection logic.
