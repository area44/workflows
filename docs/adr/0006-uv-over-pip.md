# ADR 0006: uv Over pip When Both Available

**Status**: Accepted
**Date**: 2024-01-15

## Context

When a repository has signals for both `uv` and `pip` (e.g., `uv.lock` exists AND `requirements.txt` exists), which package manager wins?

Current behavior: **uv wins** — priority order is `["uv", "pip"]` (see `PYTHON_PACKAGE_MANAGER_PRIORITY` in `src/python-env/types.ts`).

Signals for uv:

- `uv.lock` file present (requires a valid `pyproject.toml` with `[project]`, `[build-system]`, or valid `[tool.uv.workspace]` configuration)
- `[tool.uv]` in `pyproject.toml` with valid workspace configuration (`members` array) or recognized `dev-dependencies` array
- `uv.toml` configuration (once a Python project has been identified through other signals)

Signals for pip:

- `requirements.txt`
- `setup.py` / `setup.cfg`
- `pyproject.toml` with `[project]` (no recognized uv configuration)

## Decision

**uv takes precedence over pip** when both are detected.

## Consequences

### Positive

- **Modern default**: uv is faster, has better caching, produces reproducible lockfiles
- **Lockfile fidelity**: `uv.lock` is a complete, cross-platform lockfile; `requirements.txt` is not
- **Single command**: `uv sync` handles both lockfile update and installation; pip requires separate steps
- **Workspace support**: uv workspaces (via valid `[tool.uv.workspace]` in `pyproject.toml`) are properly detected and supported

### Negative

- **Migration surprise**: Repos with both `uv.lock` and `requirements.txt` silently switch to uv
- **pip-only workflows**: Teams standardized on pip must remove applicable uv signals to avoid uv selection

### Neutral

- **`uv.lock` validity**: `uv.lock` requires a valid `pyproject.toml` with `[project]`, `[build-system]`, or valid `[tool.uv.workspace]` configuration. A lockfile alone is not sufficient; the project configuration must be recognized.
- **Explicit opt-out**: To use pip, remove all applicable uv signals:
  - `uv.lock`
  - Recognized `[tool.uv]` configuration in `pyproject.toml` (valid workspace or `dev-dependencies` array)
  - `uv.toml` (when it would contribute to uv detection)
    Valid pip-oriented configuration can remain, such as `requirements.txt`, `setup.py`, `setup.cfg`, or `pyproject.toml` with `[project]` and no recognized uv configuration.

## Alternatives Rejected

- **pip first (legacy default)**: Perpetuates slower, less reproducible tooling; contradicts ecosystem direction
- **Fail on ambiguity**: Would require explicit `python-package-manager` input; adds friction for majority case
- **Detect from `pyproject.toml` `[tool.uv]` only**: Would miss `uv.lock` with valid `pyproject.toml`

## Related

- ADR 0005: Python project detection includes source files
- `src/python-env/package-manager-detector.ts` — `detectPythonPackageManager` implementation
- `docs/environment-resolution.md` — Python package manager rules
