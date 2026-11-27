# ADR 0005: Python Project Detection Includes Source Files

**Status**: Accepted
**Date**: 2024-01-15

## Context

When is a repository a "Python project" for the purposes of dependency installation? Options:

1. **Manifest-only**: Only if dependency configuration exists (`pyproject.toml`, `requirements.txt`, `setup.py`, `uv.lock`, etc.)
2. **Source-inclusive** (current): Manifest-only OR if `.py`/`.pyi` source files exist anywhere in the repo

Current behavior: A repo with only `main.py` and no `pyproject.toml`/`requirements.txt` is detected as a Python project.

## Decision

**Detect Python projects by dependency configuration OR Python source files.**

## Consequences

### Positive

- **Scripts without manifests are detected**: Single-file scripts, glue code, and minimal projects receive Python runtime and package-manager provisioning.
- **No false negatives**: A repo with Python code but no manifest (yet) still gets Python runtime + package manager provisioned.
- **Consistent intent with JS**: JavaScript domain detects via `package.json` — presence of a project manifest triggers the domain. Lockfiles and version files influence package manager/runtime resolution but do not independently trigger domain detection.

### Negative

- **Over-detection**: A repo with a stray `.py` file (e.g., generated, vendored, test fixture) triggers Python setup.
- **Standalone projects**: A Python project with source but no manifest gets `isStandalone: true` — skips dependency installation entirely but still provisions runtime/pm.

### Neutral

- **`uv.toml` excluded**: Explicitly NOT recognized as a project manifest (uv workspaces use `pyproject.toml` with `[tool.uv]`).
- **Two-phase in autofix**:
  - **Project detection** → decides whether to provision Python runtime and package manager (runs for ALL detected projects).
  - **Source detection** → decides whether to run Ruff lint/format (only when `.py`/`.pyi` files exist).
- **Dependency installation**: Only runs when a supported dependency configuration is present (e.g., `pyproject.toml` with `[project]`, `requirements.txt`, `setup.py`, `setup.cfg`, `uv.lock` with valid `pyproject.toml` containing `[project]`, `[build-system]`, valid `[tool.uv.workspace]`, or recognized `[tool.uv]` `dev-dependencies` array, or recognized `[tool.uv]` config). Source-only projects without such configuration skip dependency installation entirely.
- **Ruff execution**: Runs when Python source files are detected (`.py`/`.pyi`), independent of whether dependency installation occurred. If dependency installation fails, Ruff does not execute.

## Alternatives Rejected

- **Manifest-only**: Would miss legitimate Python projects that haven't added a manifest yet.
- **Source-only**: Would miss projects with manifests but no source (e.g., pure dependency consumers, template repos).

## Related

- ADR 0006: uv over pip when both available
- `docs/environment-resolution.md` — Python Autofix Lifecycle (project vs source detection)
- `src/python-env/project-inspector.ts` — `hasPythonProject` implementation
