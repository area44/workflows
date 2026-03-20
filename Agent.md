# Agent Instructions

This repository contains reusable GitHub Actions workflows and composite actions for the AREA44 ecosystem.

## Project Structure

- `src/core/`: Contains the core logic for environment detection and autofix scripts.
- `src/run-*.ts`: Entry point scripts that are bundled into `dist/`.
- `dist/`: Contains the bundled and minified JavaScript files used by the actions. **Do not edit these files directly.**
- `astro/`, `autofix/`, `vite/`: Directory for each composite action containing its `action.yml` and `README.md`.
- `__tests__/`: Unit tests for the core logic.

## Development Workflow

1.  **Modify Source**: Make changes in `src/`.
2.  **Run Tests**: Ensure all tests pass with `npm run test`.
3.  **Build**: Bundle and minify the scripts with `npm run build`.
4.  **Verify Build**: Ensure the artifacts in `dist/` are updated correctly.

## Coding Conventions

- Use ES modules.
- Use TypeScript for all source code.
- Use descriptive names for internal functions (e.g., `setOutputs` instead of `run`).
- Keep core logic independent of the GitHub Actions environment where possible (extract into `src/core/`).
