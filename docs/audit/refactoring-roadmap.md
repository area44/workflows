# Refactoring Roadmap

## Phase 1 (P1): Security/Reliability

- Audit exec.ts command execution; add tests.
- Verify workflow permissions and pinning.

## Phase 2 (P2): Testing

- Stabilize Windows consumer generator tests or mark environment-specific.
- Add autofix engine integration tests.

## Phase 3 (P3): Cleanup

- Remove `as any` in base-adapter.
- Fix lint warning in skill validator.

## Proposed Issues

1. Audit command execution in autofix exec module.
2. Add least-privilege permissions to GitHub workflows.
3. Stabilize consumer project generator tests on Windows.
4. Remove unsafe type assertion in base-adapter.
5. Fix unused catch variable in skill validator.
