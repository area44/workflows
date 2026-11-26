# Agent Instructions

Reusable GitHub Actions composite actions for the AREA44 ecosystem. Source lives in `src/`; `action.yml` files (`pages/`, `autofix/`) are the public API; bundled entrypoints in `dist/` are generated from `src/` and committed.

## Workflow

1. Install: `npm ci`
2. Make changes in `src/`.
3. If `src/` changed: rebuild with `npm run build` and commit `dist/` — `check-dist` in CI fails otherwise.
4. Format/lint/typecheck: `npm run lint` and `npm run format -- --check`. Auto-fix with `npm run format` or `npm run lint -- --fix`.
5. Test: `npm test`.

Do not hand-edit `dist/` — it is generated. Do not add runtime dependencies to published actions without a changeset.

## Commands

| Task               | Command                     |
| ------------------ | --------------------------- |
| Install            | `npm ci`                    |
| Build `dist/`      | `npm run build` (`vp pack`) |
| Unit + integration | `npm test` (`vp test`)      |
| Lint + typecheck   | `npm run lint` (`vp lint`)  |
| Format check       | `npm run format -- --check` |
| Format fix         | `npm run format`            |
| Changeset          | `npm run changeset`         |

Run `npm run <script>` (or `npx vp <task>`) rather than calling `vp` directly unless it is on `PATH`.

## Completion criteria

A change is done only when:

- `npm run lint` passes with no errors.
- `npm run format -- --check` passes.
- `npm test` passes (on Windows, scenario-factory spawning tests in `tests/generate-consumer-project.test.ts` fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`; treat remaining suites as the gate).
- If `src/` changed: `npm run build` was run and `dist/` changes are staged.

## Where to look

- Public action API (inputs/outputs/steps): `pages/action.yml`, `autofix/action.yml`.
- Behavior details: [pages/README.md](pages/README.md), [autofix/README.md](autofix/README.md).
- Environment resolution: [docs/environment-resolution.md](docs/environment-resolution.md).
- Build/release/test architecture: [docs/maintenance.md](docs/maintenance.md), [docs/integration-testing.md](docs/integration-testing.md).
