# ADR 0006: uv Over pip When Both Available

**Status**: Accepted
**Date**: 2024-01-15

## Context

When a repository has signals for both `uv` and `pip` (e.g., `uv.lock` exists AND `requirements.txt` exists), which package manager wins?

Current behavior: **uv wins** — priority order is `["uv", "pip"]` (see `PYTHON_PACKAGE_MANAGER_PRIORITY` in `src/python-env/types.ts`).

Signals for uv:

- `uv.lock` file present
- `[tool.uv]` in `pyproject.toml` with workspace or dev-dependencies

Signals for pip:

- `requirements.txt`
- `setup.py` / `setup.cfg`
- `pyproject.toml` with `[project]` (no uv config)

## Decision

**uv takes precedence over pip** when both are detected.

## Consequences

### Positive

- **Modern default**: uv is faster, has better caching, produces reproducible lockfiles
- **Lockfile fidelity**: `uv.lock` is a complete, cross-platform lockfile; `requirements.txt` is not
- **Single command**: `uv sync` handles both lockfile update and installation; pip requires separate steps
- **Workspace support**: uv workspaces (via `[tool.uv]` in `pyproject.toml`) are properly detected and supported

### Negative

- **Migration surprise**: Repos with both `uv.lock` and `requirements.txt` silently switch to uv
- **pip-only workflows**: Teams standardized on pip must remove `uv.lock` or add explicit uv config to opt out

### Neutral

- **`uv.lock` without `pyproject.toml` is an error**: Prevents half-migrated state where lockfile exists but manifest doesn't
- **Explicit opt-out**: Repos can force pip by removing `uv.lock` and ensuring no `[tool.uv]` config

## Alternatives Rejected

- **pip first (legacy default)**: Perpetuates slower, less reproducible tooling; contradicts ecosystem direction
- **Fail on ambiguity**: Would require explicit `python-package-manager` input; adds friction for majority case
- **Detect from `pyproject.toml` `[tool.uv]` only**: Would miss `uv.lock`-only projects (valid uv usage)

## Related

- ADR 0005: Python project detection includes source files
- `src/python-env/package-manager-detector.ts` — `detectPythonPackageManager` implementation
- `docs/environment-resolution.md` — Python package manager rules
