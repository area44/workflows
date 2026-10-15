---
"@area44/workflows": minor
---

Refactor Autofix composite action architecture: introduce `src/javascript-env.ts` for JavaScript/TypeScript environment inspection, lockfile-based installation plan generation (`npm ci`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`), and script evaluation. Replace inline shell installation commands in `autofix/action.yml` with TypeScript orchestration in `src/autofix.ts`, and automatically skip dependency installation when no matched scripts exist in `package.json`.
