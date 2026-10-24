# @area44/workflows

## 9.0.0

### Major Changes

- c399566: refactor: remove custom errors, process-utils, and sanitize modules

  - Deleted `src/errors.ts`, `src/process-utils.ts`, and `src/sanitize.ts`.
  - Removed `WorkflowError`, `WorkflowErrorCode`, `WorkflowErrorContext`, `isWorkflowError`, `isExecutableAvailable`, `sanitizeCommandString`, and `sanitizeCause` exports and utility abstractions.
  - Switched executable availability checks to `@actions/io.which()`.
  - Migrated all error reporting to standard native JavaScript `Error` classes and `@actions/core.setFailed()`.

- a625e71: Remove legacy string-based Python installCommand property and resolvePythonInstallCommands fallback interpreter in favor of canonical structured installCommands arrays.

  BREAKING CHANGE: The legacy `installCommand` string property on Python environment metadata is removed. Python package manager detection, validation, and autofix dependency execution strictly enforce structured `installCommands` argument arrays.

- f903787: Consolidate deployment functionality into a single unified `pages` action for GitHub Pages deployments with automatic Vite+ detection and build output validation.

  BREAKING CHANGE: Removed previously public deployment action entry points (`astro`, `vite-plus`) in favor of the single unified `pages` action.

### Patch Changes

- b253c28: Complete uv environment detection including uv.toml support, repository-bounded parent directory context discovery for workspace members and nested packages, and refined uv project table classification.
- 1f031cc: Consolidate internal environment resolution onto canonical APIs and remove obsolete legacy wrappers, aliases, and overloads.

  - Removed legacy functions and aliases: `parseRuntimeInput`, `detectProjectEnvironment`, `detectRuntime`, `detectPackageManager`, `detectNodeVersion`, `detectBunVersion`, `detectEnv`, `getPnpmRuntime`, and `getDefaultPackageManagerVersion`.
  - Simplified `writeOutput` signature to strictly accept `writeOutput(env: ResolvedEnvironment): void`.
  - Refactored `resolvePnpmSetupRuntime` to accept `Pick<ResolvedEnvironment, "bunVersion" | "nodeVersion">`.
  - Updated internal callers and test suites to exercise canonical environment resolution APIs directly.

- 4d08049: fix(pages): normalize build output path and validate repository metadata
- aac61f4: Refactor Environment Resolution into Language-Specific Modules
- 2886f12: fix(autofix): include tests/ and **tests**/ directories in Python source detection
- 1141d72: Fix TOML parsing and preserve Python project detection behavior.
- 854a026: Harden Autofix action workflow isolation and lockfile synchronization so JavaScript and Python workflows run independently with error aggregation.
- 8c943ba: refactor(pages): consolidate BASE and BASE_URL log output
- 70d2540: refactor: separate Autofix domain source files into src/autofix/
- dec2993: refactor(pages): automatically resolve SITE, BASE, and BASE_URL from GitHub context

  - Automatically resolve `SITE`, `BASE`, and `BASE_URL` environment variables from GitHub repository context (`GITHUB_REPOSITORY` and `GITHUB_REPOSITORY_OWNER`).
  - Removed external user input configuration, URL validation, and normalization logic for `SITE`, `BASE`, and `BASE_URL`.
  - Hardened build output directory validation and error reporting.
  - Updated Pages action documentation and tests to reflect automatic site variable resolution.

- 3d81e6b: refactor: simplify environment detection logic
- ef0f6f3: refactor(environment): fix devEngines parsing and whitespace normalization
- e04ae46: refactor: unify action bootstrap runtime across all composite actions

  - Standardize Node.js as the common action bootstrap runtime for executing internal bundled `.mjs` entrypoints across all composite actions.
  - Remove conditional executable selection for internal action entrypoints based on `RUNTIME`.
  - Preserve distinct canonical project outputs `RUNTIME` and `PACKAGE_MANAGER` for executing project dependency installation and build scripts.
  - Hardened step outcome conditions across composite action steps in `pages/action.yml` and `autofix/action.yml`.

- 3f9fe3f: Refactor Autofix action to use GitHub Actions Toolkit APIs

## 8.0.1

### Patch Changes

- 74c5aeb: Rename step from 'Update project with autofix' to 'Run autofix'
