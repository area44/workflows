# Integration Testing

How composite action behavior (`pages`, `autofix`) and environment resolution are verified against generated consumer projects.

## Scenario factory

Consumer projects are generated dynamically — there are no static fixture directories.

- `tests/helpers/consumer-project/generate-consumer-project.ts` — the single source of truth for templates, manifests, lockfiles, CLI parsing, directory checks, and overwrite protection. Requires an explicit target directory: `node --import tests/helpers/consumer-project/resolver.js tests/helpers/consumer-project/generate-consumer-project.ts <dir> [options]`.
- `tests/helpers/consumer-project/index.ts` — re-exports `createConsumerProject` and `generateConsumerProjectFiles` so unit and module tests share identical generation logic.

Factory dimensions (options): `action` (`pages`/`autofix`), `runtime` (`node`/`bun`), `pm`/`packageManager` (`npm`/`pnpm`/`bun`/version string), `toolchain` (`vite-plus`/`none`), `type` (`basic`, `minimal`, `vite`, `vite-plus`, `consumer-integration`, `python-uv`, `python-pip`, `python-conflicting`, `python-none`, `mixed`, `mixed-bun`), `hasPythonSource`, `pythonPm`, `pythonVersion`, `ruffVersion`, `markerContent`. Generation refuses to run without an explicit target; `--allow-non-empty` permits a non-empty dir without collisions, `--overwrite` permits overwriting colliding files.

## Test layers

1. **Unit + module (`npm test`)** — Vitest (`vp test`), importing `src/` directly:
   - Unit: `tests/{python-env,javascript-env,resolve-environment,build-command,site-variables,autofix,generate-consumer-project}.test.ts`.
   - Module integration: `tests/integration-consumer.test.ts` validates detection, formatting, site variables, custom build commands, and error diagnostics against generated scenarios in `os.tmpdir()`.
2. **Action matrix (`.github/workflows/test-actions.yml`)** — runs the real composite actions (`./action-source/pages`, `./action-source/autofix`) on live runners. The action repo is checked out to `action-source/`; the consumer project is generated at `$GITHUB_WORKSPACE` so `action-source/` stays pristine.
   - Positive: Astro/Vite/Vite+ pages builds; node/bun + npm/pnpm/bun sync; Python uv/pip + ruff; mixed projects.
   - Negative: `invalid_build_command` and `missing_output_dir` run `dist/pages/build-command.mjs` in a subshell harness and assert exit code 1 plus the exact `${RUNNER_TEMP}/pages_build_error.log` message.

## Adding a scenario

1. Pass options to `generateConsumerProjectFiles(options)` / `createConsumerProject(targetDir, options)`.
2. If new templates/dimensions are needed, extend `tests/helpers/consumer-project/generate-consumer-project.ts`.
3. Add unit assertions in `tests/generate-consumer-project.test.ts`.
4. Add module assertions in `tests/integration-consumer.test.ts` or a matrix entry in `.github/workflows/test-actions.yml`.

## Commands

```bash
npm test                                         # full unit + module suite
npm test tests/generate-consumer-project.test.ts # generator tests
npm test tests/integration-consumer.test.ts      # consumer integration
npm run lint
npm run format --check
npm run build
```
