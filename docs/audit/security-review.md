# Security Review

## Threat Model

Untrusted inputs: repository files (package.json, lockfiles, pyproject.toml), GitHub Actions inputs, environment variables, CLI args, file paths.

## Findings

- Command execution in `src/autofix/exec.ts` must sanitize/validate args; verify no shell injection. (P1 potential)
- Third-party actions in `.github/workflows/*` should be pinned to SHAs; review ci.yml/release.yml. (P2)
- Secrets handling: actions use `@actions/core`; ensure no secret logging. (P2)
- Generated dist/ committed; supply-chain risk if tampered; check-dist mitigates. (P2)

## Recommendations

- Audit exec.ts for `exec` vs `execFile` and argument arrays.
- Add SHA pinning where missing.
- Add permission least-privilege to workflow jobs.
