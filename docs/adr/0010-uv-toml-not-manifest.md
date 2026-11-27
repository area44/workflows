# ADR 0010: uv.toml Not Recognized as Project Manifest

**Status**: Accepted
**Date**: 2024-01-15

## Context

uv supports `uv.toml` for tool configuration (similar to `pip.conf` / `pip.ini`). Should we recognize `uv.toml` as a Python project manifest?

Python project identification and package-manager detection are separate responsibilities:

- Project identification determines whether the repository is a Python project. `uv.toml` alone must not establish that identity; project identification relies on `pyproject.toml`, lockfiles, requirements/setup files, or Python source files.
- Package-manager detection determines whether uv is used once a Python project has already been identified. In that phase, `uv.toml` may contribute to detecting uv.

`pyproject.toml`, `uv.lock`, and `uv.toml` therefore have distinct roles: `pyproject.toml` carries project metadata and uv configuration, `uv.lock` is a lockfile tied to a valid project, and `uv.toml` is tool configuration that can inform uv detection but cannot by itself make a Python project.

## Decision

`uv.toml` is a uv configuration file, not a Python project manifest.

- The presence of `uv.toml` alone does not establish Python project identity.
- Once a Python project has been identified through other signals, `uv.toml` may contribute to uv package-manager detection.
- `[tool.uv]` in `pyproject.toml` and `uv.lock` retain their own roles: `[tool.uv]` can establish uv project/package-manager signals, and `uv.lock` is a lockfile that requires a valid `pyproject.toml`.
- Existing precedence and conflict-validation rules remain unchanged.

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
