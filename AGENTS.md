# area44/workflows

This file provides context and instructions for AI agents working on the @area44/workflows repository.

## Project Overview

This repository contains reusable GitHub Actions workflows and composite actions (Astro, Vite, Autofix) for the AREA44 ecosystem.

## Core Directives

- **ES Modules**: The project is configured as an ES module (`"type": "module"` in `package.json`). Build artifacts in `dist/` are also generated as ESM.
- **Tracked Build Artifacts**: The `dist/` folder is tracked in the repository to allow composite actions to be used directly without a build step in consuming workflows.
- **Clean Distribution**: The `dist/` directory must only contain final bundled JavaScript files. Do not include source files or redundant artifacts.
- **Compatibility**: Preserve original `action.yml` files in root directories (astro/, autofix/, vite/) and maintain original public inputs/outputs for backward compatibility.
- **No Shared Chunks**: `rolldown.config.mjs` uses separate configurations for each entry point to prevent shared chunks that cause "require" errors in ESM-based GitHub Actions runners.

## Development & Build

- **Build**: Use `npm run build` to bundle the project using Rolldown.
- **Minification**: Output files are minified (`minify: true` in `rolldown.config.mjs`).
- **Formatting**: Use `npm run format` to format the project using `oxfmt`. The `dist/` folder is ignored via `.oxfmtignore`.
- **Node.js**: The project uses Node 24 and targets the Node platform for bundling.

## Testing

- **Unit Tests**: Use Vitest for unit testing. Tests are located in `__tests__/`. Run them with `npm run test`.
- **Integration Tests**: Integration tests are split into separate workflow files (`.github/workflows/`) to ensure isolated runs and avoid artifact name conflicts.
- **Environment Detection**: Core environment detection logic is in `src/detect-env.ts`.
- **Fixer Logic**: Core logic for running lint/format scripts is in `src/fixer.ts` (function `executeFixer`).

## Coding Preferences

- Use descriptive names for internal functions (e.g., `setOutputs`, `executeFixer`) rather than generic names.
- Always include an 'eslint-disable' banner in generated files via rolldown config.
