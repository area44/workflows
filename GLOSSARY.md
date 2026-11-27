# Glossary

Authoritative definitions for terms used in the AREA44 workflows codebase. This glossary is the single source of truth for domain language; code, docs, and discussions should use these terms consistently.

---

## Core Concepts

### Action

A reusable GitHub Actions **composite action** published at `area44/workflows/<action>@main`. This repo contains two actions: **pages** and **autofix**.

### Domain

A language ecosystem that resolves and executes independently. This codebase recognizes two domains: **JavaScript/TypeScript** and **Python**. A repository may contain either, both, or neither.

### Environment Resolution

The process of inspecting a repository's files and configuration to produce a **Resolved Environment** — a deterministic, validated description of detected runtimes, package managers, toolchains, and project structure.

### Resolved Environment

The aggregate output of environment resolution. Contains detected JavaScript and Python environments. This is the **single source of truth** for all downstream planning and execution.

### Setup Plan

A pure, deterministic transformation that derives GitHub Actions setup parameters from a Resolved Environment. It has no filesystem access, side effects, or detection logic.

### Toolchain

The toolchain recognized by the Pages action for default build-command resolution. Currently only **vite-plus** is recognized (detected via Vite+ dependency in `package.json`). Affects the default build command for the **pages** action.

---

## JavaScript Domain

### Runtime

The JavaScript execution environment: **node** or **bun**. Determined by precedence:

1. `devEngines` in `package.json`
2. Version files (`.bun-version` vs `.nvmrc`/`.node-version`)
3. Package manager (`bun` implies Bun runtime)
4. Default: Node.js

Contradictory signals (e.g., both Bun and Node.js config) **fail validation** rather than applying a silent tie-breaker.

### Package Manager

The dependency manager: **npm**, **pnpm**, or **bun**. Determined by precedence:

1. `packageManager` field in `package.json`
2. `devEngines.packageManager` in `package.json`
3. Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `bun.lock`)
4. Default: `npm`

### Installation Plan

The command and arguments to install JavaScript dependencies. Derived from the resolved package manager.

### Vite+

The toolchain recognized by the Pages action for default build-command resolution. Detected by presence of a Vite+ dependency in `package.json`. When detected, the **pages** action defaults to `vp build` (falls back to `vpr build`).

---

## Python Domain

### Python Project

A repository recognized as a Python project based on **dependency configuration OR Python source code**. Recognized by:

- `pyproject.toml` with `[project]` or `[build-system]`
- `uv.lock`
- `requirements.txt`
- `setup.py` / `setup.cfg`
- `[tool.uv]` in `pyproject.toml` (workspace or dev-dependencies)
- `.py`/`.pyi` source files (even without dependency manifests)

**`uv.toml` is NOT recognized** as a project manifest.

### Python Source

Python source files (`.py`/`.pyi`) found within the project tree, excluding known dependency, virtual environment, cache, and build directories. Their presence determines whether Python tooling such as Ruff lint and format tasks execute.

### Python Package Manager

**uv** or **pip**. Determined by:

- `uv` when a valid `uv.lock` (with valid `pyproject.toml`), recognized uv configuration
  in `pyproject.toml`, or applicable `uv.toml` configuration
  is detected for an identified Python project.
- `pip` otherwise (default).

`uv.toml` alone does not establish Python project identity.
`uv.lock` without a valid `pyproject.toml` is an error.

**Explicit opt-out**: To force pip, remove all uv signals: `uv.lock`, `[tool.uv]` in `pyproject.toml`, and `uv.toml`, while retaining valid pip configuration.

### Installation Commands

The commands used to install Python dependencies. For uv: `uv sync`. For pip: `pip install` from detected config.

---

## Autofix Domain

### Provider

A language-specific execution unit registered in the registry. Owns detection of applicability and provision of tool adapters, plus an optional custom setup and execution lifecycle.

Current providers: `javascript`, `python`.

### Adapter

A tool-specific integration that detects applicability and plans execution tasks. Examples: `ruff` adapter (Python), `vite-plus-detector` / `tools` adapter (JavaScript).

### Execution Task

A planned unit of work executed by the execution engine. It describes a command invocation, its arguments, working directory, execution mode, and optional provider ownership.

### Planned Execution

The authoritative output of planning: the set of execution tasks plus selected and skipped tools. A planning failure is a real error, not an empty plan.

### Conflict Domain

Scope for capability deduplication and conflict resolution. Provider adapters default to `provider.id` (e.g., "javascript", "python"). Standalone adapters default to an isolated per-adapter scope (`standalone:${id}`) and may explicitly match a provider id or shared scope to resolve genuine conflicts within that domain.

### Execution Engine

The generic executor that resolves executables, logs each run, and aggregates diagnostics.

---

## Build & Release

### Entrypoint

A bundled ESM file in `dist/` (e.g., `dist/resolve-environment.mjs`, `dist/autofix.mjs`) invoked by the composite action's steps.

### Dist Commitment

`dist/` is **committed** and must match `src/`. `npm run build` (`vp pack`) regenerates `dist/`. CI fails (`check-dist`) if `src/` changed without rebuilding.

### Changeset

A markdown file in `.changeset/` describing a user-facing change. Used by `@changesets/cli` to automate version bumps, `CHANGELOG.md`, and GitHub Releases.

---

## Validation & Error Handling

### Contradictory Configuration

Conflicting signals (e.g., both `.bun-version` and `.nvmrc`, or `packageManager: bun` with Node.js `devEngines`) cause **validation failure** (`core.setFailed`) rather than silent tie-breaking.

### Invalid Environment

A resolved environment that fails structural validation (missing fields, wrong types, or invariant violations such as a lockfile without a project manifest).

### Standalone Python Project

A Python project with a package manager but no dependency configuration (no lockfile, no config file). Skips dependency installation entirely.
