# Agent Guide

This file provides context and instructions for AI agents working on the @area44/workflows repository.

## Project Overview

This repository contains reusable GitHub Actions workflows and composite actions (Astro, Vite, Vite-Plus, Lint-Format) for the AREA44 ecosystem.

## Core Directives

- **Vite+ (vp)**: The project is managed by Vite+, providing unified tooling for package management, build, test, lint, and formatting.
- **ES Modules**: The project is configured as an ES module (`"type": "module"` in `package.json`). Build artifacts in `dist/` are generated as ESM via `vp pack`.
- **Tracked Build Artifacts**: The `dist/` folder is tracked in the repository to allow composite actions to be used directly without a build step in consuming workflows.
- **Clean Distribution**: The `dist/` directory must only contain final bundled JavaScript output files. Do not include source files or redundant artifacts.
- **Compatibility**: Preserve original `action.yml` files in root directories and maintain original public inputs/outputs for backward compatibility.
- **Centralized Configuration**: All tool configurations (build, lint, test, format) are consolidated in `vite.config.ts`.

## Development & Commands

- **Setup**: Run `vp install` to install dependencies and ensure local binaries are available.
- **Build**: Use `vp pack` to bundle the project. Output files are minified and include an `eslint-disable` banner.
- **Lint & Format**: Use `vp lint` and `vp fmt`. Formatting enforces sorted imports and mandatory curly braces for control flow.
- **Unified Validation**: Use `vp check` (or `vp check --fix`) for pre-commit validation.
- **Node.js**: The project uses Node 24. For GitHub Actions, set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` to address Node.js 20 deprecation warnings.
- **Package Management**: Prioritize the `packageManager` field in `package.json`. Bun 1.2+ support favors `bun.lock` and excludes the deprecated `bun.lockb`.

## Testing

- **Unit Tests**: Use Vitest (via `npx vitest run`) for unit testing logic in `__tests__/`.
- **Integration Tests**: Split into separate workflow files (e.g., `test-astro.yml`, `test-lint-format.yml`) to ensure isolated runs.
- **Environment Detection**: Logic in `src/detect-env.ts` detects Node.js version (checking `.nvmrc`, `.node-version`, `engines`) and package manager.

## GitHub Actions Logic

- **Dynamic Environment Variables**: The Vite and Vite-Plus actions dynamically set `VITE_SITE_URL` and `BASE` based on the repository context (project site vs. user/org page).
- **Autofix CI**: Integration with `autofix-ci/action@v1` requires the workflow name to be `autofix.ci` and the file to be `autofix.yml` or `autofix.ci.yml`.

## Coding Preferences

- **Naming**: Use descriptive names for internal functions (e.g., `setOutputs`) and variables (e.g., `error` instead of `err`) to satisfy strict linting.
- **Formatting**: Import sorting is enforced by group (type, external, internal, etc.). Mandatory curly braces are required for all control flow statements.
