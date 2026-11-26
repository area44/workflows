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

The aggregate output of environment resolution. Contains two sections:

- `javascript`: `ResolvedJavaScriptEnvironment` (detected, runtime, packageManager, toolchain)
- `python`: `ResolvedPythonEnvironment` (detected, packageManager, hasSource)

This is the **single source of truth** for all downstream planning and execution.

### Setup Plan

A pure, deterministic transform (`createSetupPlan`) that derives **GitHub Actions setup parameters** (which `setup-*` actions to run, with what cache keys) from a `ResolvedEnvironment`. Has no filesystem access, no side effects, no detection logic.

### Toolchain

A recognized build/test framework that influences execution behavior. Currently only **vite-plus** is recognized (detected via Vite+ dependency in `package.json`). Affects the default build command for the **pages** action.

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

The command and arguments to install JavaScript dependencies (`JsInstallationPlan`). Derived from the resolved package manager.

### Vite+

The **only recognized toolchain**. Detected by presence of a Vite+ dependency in `package.json`. When detected, the **pages** action defaults to `vp build` (falls back to `vpr build`).

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

The presence of `.py`/`.pyi` files anywhere in the repo (including test directories). Determines whether **Ruff lint/format tasks execute**.

### Python Package Manager

**uv** or **pip**. Determined by:

- `uv` when `uv.lock` OR explicit uv config in `pyproject.toml` (`[tool.uv]` with workspace or dev-dependencies)
- `pip` otherwise (default)

**`uv.lock` without a valid `pyproject.toml` is an error.**

### Installation Commands

The exact commands to install Python dependencies (`PythonPackageManagerInfo.installCommands`). For uv: `uv sync`. For pip: `pip install` from detected config.

---

## Autofix Domain

### Provider

A language-specific execution unit registered in the **registry**. Owns:

- `detect(context)`: whether it applies to the current project
- `plan(context, mode)`: returns `ExecutionTask[]` for the mode (`fix`/`check`)
- Optional `run(context, tasks, engine)`: custom lifecycle (setup + execution)

Current providers: `javascript`, `python`.

### Adapter

A tool-specific implementation that produces `ExecutionTask[]`. Examples: `ruff` adapter (Python), `vite-plus-detector` / `tools` adapter (JavaScript).

### Execution Task

A single command to execute: `{ id, name, command, args, workingDirectory, providerId?, conflictDomain? }`.

### Planned Execution

The output of `planExecution`: `{ tasks: ExecutionTask[], selectedTools, skippedTools }`. The **authoritative plan** — a planning failure is a real error, not an empty plan.

### Conflict Domain

Scope for capability deduplication and conflict resolution. Defaults to `provider.id` (e.g., "javascript", "python"). Standalone adapters can explicitly match a provider id to resolve genuine conflicts within that domain.

### Execution Engine

The generic executor that resolves executables (`passthrough`/`path`/`project-binary`), logs each run as `Executing: <command>`, and aggregates diagnostics.

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

A `ResolvedEnvironment` that fails structural validation (missing fields, wrong types, invariant violations like `uv.lock` without `pyproject.toml`).

### Standalone Python Project

A Python project with `pmInfo.isStandalone: true` — has a package manager but **no dependency configuration** (no lockfile, no config file). Skips dependency installation entirely.
