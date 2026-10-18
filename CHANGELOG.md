# @area44/workflows

## 8.1.0

### Minor Changes

- b25432b: Add Python lint and formatting support with Ruff across autofix action workflows, featuring automatic Python package manager detection (`uv`, `pip`), automatic dependency installation, lockfile synchronization, and `pyproject.toml` configuration.
- 2154c07: Migrate release workflow to Changesets and remove custom verify system.
- 98c17d7: Refactor Autofix composite action architecture: introduce `src/javascript-env.ts` for JavaScript/TypeScript environment inspection, lockfile-driven installation plan generation (`npm install`, `pnpm install --no-frozen-lockfile`, `bun install`), and script evaluation. Replace inline shell installation commands in `autofix/action.yml` with TypeScript orchestration in `src/autofix.ts`, and automatically skip dependency installation when no matched scripts exist in `package.json`.

### Patch Changes

- ec80c13: Fix remaining review issues in PR #236: enhance secret sanitization to redact quoted flag values, sensitive environment variable assignments, Bearer tokens, and URL credentials; capture and sanitize child-process stdout/stderr in `autofix`; and add regression test coverage.
- f14487e: Improve Autofix error handling, logging, and file safety by throwing structured `WorkflowError` instances (`COMMAND_EXECUTION_FAILURE`, `SETUP_FAILURE`, `MISSING_CONFIGURATION`) with sanitized command strings and cause messages, propagating error state cleanly via `core.setFailed`, and preserving workspace files on failure.
- f48c76b: Refactor Autofix workflow step names and consolidate Ruff setup/linting/formatting into a single setup step and single shell step, extract executable detection (`isExecutableAvailable`) to a shared process module, completely remove the obsolete `action-contract` mechanism and dead validation code, and update documentation and build artifacts.
