# ADR 0009: Vite+ as Only Recognized Toolchain

**Status**: Accepted
**Date**: 2024-01-15

## Context

The **pages** action needs a default build command for JavaScript projects. Options for toolchain recognition:

1. **Multiple toolchains**: Detect Vite, Next.js, Astro, SvelteKit, etc.; each with its own default build command
2. **Single toolchain** (current): Only **Vite+** recognized; detected via Vite+ dependency in `package.json`
3. **No toolchain detection**: Always use `<package-manager> run build`; consumer must set `build-command` input for non-standard setups

## Decision

**Only Vite+ is recognized as a toolchain.** When detected, the **pages** action defaults to `vp build` (falls back to `vpr build`). All other frameworks use `<package-manager> run build` (or custom `build-command` input).

## Consequences

### Positive

- **Simplicity**: One toolchain, one detection heuristic, one default command
- **Dogfooding**: AREA44 ecosystem uses Vite+; the action is optimized for the primary use case
- **Explicit opt-in for others**: Next.js, Astro, etc. consumers set `build-command: "npm run build"` (or their framework's command) — clear, intentional
- **No framework churn**: Adding/removing framework detection would be endless maintenance

### Negative

- **Non-Vite+ consumers must configure**: Slight friction for Next.js/Astro/etc. users (one extra input line)
- **Vite+ coupling**: If AREA44 migrates away from Vite+, this default becomes legacy

### Neutral

- **`vp` vs `vpr`**: `vp` is the Vite+ CLI; `vpr` is the runtime-only variant. Fallback handles environments where `vp` isn't globally available.
- **Toolchain output**: `javascript-toolchain` output is `"vite-plus"` or `""` — consumers can read it for their own logic

## Alternatives Rejected

- **Multiple toolchains**: Maintenance burden (every framework release may change build command); detection heuristics conflict (e.g., Next.js + Vite in same repo); no clear boundary
- **No toolchain detection**: Forces all consumers to specify `build-command`; worse DX for primary use case (Vite+)

## Related

- ADR 0001: Composite actions over reusable workflows
- `src/pages/build-command.ts` — Build command resolution logic
- `src/javascript-env/toolchain-resolver.ts` — `hasVitePlusDependency`, `resolveToolchain`
- `pages/action.yml` — `build-command` input default
