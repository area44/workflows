# Technical Debt

- Single `as any` in `src/autofix/adapters/javascript/base-adapter.ts:155`.
- Windows-specific test failures in consumer generator (environment limitation).
- One lint warning in skill validator (non-production).
- Potential large module count in autofix JS adapter; monitor cohesion.

## Classification

- P3: lint warning in skill script.
- P2: Windows spawn test failures (environment).
- P3: type assertion in base-adapter.
