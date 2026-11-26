# Repository Overview

## Summary

`@area44/workflows` is a private, reusable GitHub Actions composite action library for the AREA44 ecosystem. Source lives in `src/`; public APIs are `pages/action.yml` and `autofix/action.yml`; generated bundles in `dist/` are committed.

## Entrypoints

- `src/resolve-environment.ts` → `dist/resolve-environment.mjs`
- `src/setup-plan.ts` → (setup planning)
- `src/pages/build-command.ts`, `src/pages/site-variables.ts` → `dist/pages/*`
- `src/autofix/index.ts` → `dist/autofix.mjs`

## Modules

- `src/javascript-env/*`: runtime/package manager resolution, project inspection, installation plan.
- `src/python-env/*`: Python project inspection, package manager detection, uv workspace.
- `src/pages/*`: build command and site variables.
- `src/autofix/*`: autofix engine, exec, registry, adapters (JS/Python), planner, providers.
- `src/utils/*`: shared utilities.

## Quality Checks (recorded)

- `npm run lint`: pass (1 warning in `.agents/skills/security-audit/validate-findings.cjs`, not production source).
- `npm test`: 486 passed, 5 failed in `tests/generate-consumer-project.test.ts` due to Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME` spawning (expected per AGENTS.md).
- Build not re-run (no src changes).
