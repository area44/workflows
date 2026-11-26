# ADR 0010: uv.toml Not Recognized as Project Manifest

**Status**: Accepted
**Date**: 2024-01-15

## Context

uv supports `uv.toml` for tool configuration (similar to `pip.conf` / `pip.ini`). Should we recognize `uv.toml` as a Python project manifest?

Current behavior: **No** — `uv.toml` is explicitly ignored. Python project detection only recognizes:

- `pyproject.toml` with `[project]` or `[build-system]`
- `uv.lock`
- `requirements.txt`
- `setup.py` / `setup.cfg`
- `[tool.uv]` in `pyproject.toml` (workspace or dev-dependencies)
- `.py`/`.pyi` source files

## Decision

**Do not recognize `uv.toml` as a project manifest.**

## Consequences

### Positive

- **Alignment with uv semantics**: `uv.toml` is for _tool configuration_ (auth, index URLs, cache dir), not _project metadata_. uv workspaces and projects are defined in `pyproject.toml`.
- **Avoids false positives**: A repo with only `uv.toml` (e.g., global uv config checked in) would incorrectly trigger Python setup
- **Single manifest authority**: `pyproject.toml` is the canonical project manifest in the Python ecosystem (PEP 621)

### Negative

- **Edge case**: A minimal uv project using only `uv.toml` + `uv.lock` (no `pyproject.toml`) would not be detected — but this is not a valid uv project structure

### Neutral

- **`[tool.uv]` in `pyproject.toml` IS recognized**: Workspace config (`members`) and dev-dependencies trigger project detection — this is the correct uv project signal

## Alternatives Rejected

- **Recognize `uv.toml`**: Would conflate tool config with project definition; uv itself doesn't treat `uv.toml` as a project manifest
- **Recognize any `uv.toml` + `uv.lock`**: Heuristic; fragile; doesn't match uv's own project discovery

## Related

- ADR 0005: Python project detection includes source files
- ADR 0006: uv over pip when both available
- `src/python-env/project-inspector.ts` — `hasPythonProject` explicitly checks `pyproject.toml`, not `uv.toml`
- `docs/environment-resolution.md` — Python Project Detection
