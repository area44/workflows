# Environment Resolution Algorithm Guide

This guide explains the design principles, decision flow, conflict handling, and maintenance rules for repository environment resolution in `@area44/workflows`.

---

## Purpose and Scope

Environment resolution is the initial phase of composite action execution (`pages` and `autofix`). It inspects a repository's configuration and source files, resolves the effective execution environment, derives a deterministic tool setup plan, and exports GitHub Actions outputs for downstream execution steps.

Environment resolution determines which runtimes and package managers a repository targets. Downstream composite action steps execute builds, dependency installations, and autofix commands based on the exported outputs without mutating repository files.

---

## Core Principles

- **Domain Independence**: JavaScript/TypeScript and Python project resolution operate as independent domains. Repositories can contain JavaScript, Python, both, or neither. When neither domain is detected, the standalone plain-text message `No JavaScript or Python environment detected.` is emitted and resolution continues without error.
- **Toolchain Classification**: Vite+ is the only supported JavaScript toolchain (`Toolchain: Vite+`). Standard Vite alone is not classified or reported as a toolchain. When Vite+ is not detected, the `Toolchain` line is omitted entirely.
- **Project-Declared Version Reporting**: Version information (Python runtime, `uv`, `Ruff`) strictly reflects declared project configuration or constraints (e.g., `requires-python = ">=3.10,<3.14"` resolves to `python-version: ">=3.10,<3.14"`). Range constraints and exact pins are displayed as declared without converting constraints to synthetic exact numbers or inventing default versions. When unconfigured, version outputs remain empty.
- **Python Package Manager Selection**: Default package manager is `pip`. `uv` is selected when `uv.lock` or explicit `uv` configuration (`[tool.uv]` table or `uv.toml`) is detected.
- **Python Tooling Boundary**: Ruff is a Python linting and formatting tool, not a toolchain. It is excluded from environment summary logging, while its `ruff-version` output and execution workflow are preserved.
- **Plain-Text Logging**: Summary logs use plain-text output in stable category order (`Runtime`, `Package Manager`, `Toolchain`) without GitHub Actions grouping markers (`::group::`/`::endgroup::`).
- **Explicit Conflict Validation**: Contradictory configuration declarations across manifest files, version files, and package managers trigger immediate validation errors rather than applying silent tie-breakers.
- **Pure Setup Planning**: Environment resolution and filesystem inspection are strictly separated from setup plan generation. Setup plans are derived through a pure, deterministic transformation layer with zero filesystem access or action side effects.

---

## Resolution Algorithm

The environment resolution entrypoint (`run()` in `src/resolve-environment.ts`) executes environment discovery, domain resolution, aggregate validation, setup planning, and output export sequentially:

```mermaid
flowchart TD
    A[Repository Files & Config] --> B1[Resolve JS Domain]
    A --> B2[Resolve Python Domain]

    subgraph Domain Resolution & Conflict Handling
        B1 --> C1{Validate JS Signals}
        B2 --> C2{Validate Python Config}

        C1 -- Conflicting Signals --> FAIL[Execution Failure: core.setFailed]
        C2 -- Invalid Config / Lock --> FAIL

        C1 -- Valid / Not Detected --> D1[Resolved JS Environment]
        C2 -- Valid / Not Detected --> D2[Resolved Python Environment]
    end

    D1 --> E[Aggregate Environment]
    D2 --> E

    subgraph Aggregate Validation & Setup Planning Pipeline
        E --> F{validateEnvironment}
        F -- Invariant Violation --> FAIL
        F -- Valid Aggregate Env --> G[createSetupPlan\nDerive Pure Setup Plan]
        G --> H[core.setOutput\nExport Action Outputs]
    end

    H --> I[Downstream Action Step Guards\npages / autofix]
```

---

## Conflict Handling

The algorithm distinguishes clearly between missing information (handled by deterministic defaults) and invalid or contradictory configuration (which halts step execution):

- **Successful Resolution**: Valid, non-contradictory configuration signals are resolved to explicit runtime, package manager, version, and toolchain settings.
- **Undetected Domains or Missing Info**: Absent project files or unspecified versions return valid `detected: false` states or apply context-appropriate defaults without error. When neither domain is detected, an informational log is emitted and resolution completes successfully.
- **Conflicting Signals**: Contradictory declarations (such as declaring conflicting runtimes across configuration files) fail validation immediately and halt execution with an error annotation (`core.setFailed`).
- **Invalid Configuration State**: Invariant violations (such as lockfiles existing without required project configuration or malformed aggregate environments) trigger explicit error messages and halt execution.

---

## Maintenance

When modifying or extending the environment resolution algorithm:

- **Implementation as Authority**: The source code and automated test suites serve as the authoritative specification for exact behavioral details and edge cases.
- **Automated Test Coverage**: Add or update automated tests in `__tests__/` when resolution logic or edge-case handling changes.
- **Documentation Synchronization**: Keep the Mermaid flowchart and core principles in this document synchronized with implementation changes, and ensure README references remain accurate.
