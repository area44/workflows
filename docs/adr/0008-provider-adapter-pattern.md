# ADR 0008: Provider/Adapter Pattern for Autofix

**Status**: Accepted
**Date**: 2024-01-15

## Context

The autofix action must support multiple languages (JavaScript, Python) and multiple tools per language (ESLint, Prettier, Biome, Ruff, etc.). Design options:

1. **Monolithic executor**: Single function with `if (js) ... else if (python) ...` and hardcoded tool logic
2. **Provider/Adapter pattern** (current): Registry of `LanguageProvider`s; each provider owns detection, planning, and optional custom lifecycle; adapters produce `ExecutionTask[]` for specific tools
3. **Plugin system**: Dynamic loading of external packages (too heavy for this scope)

## Decision

**Provider/Adapter pattern** with a central registry (`defaultRegistry` in `src/autofix/registry.ts`).

### Provider (`LanguageProvider`)

- `id`: unique string (e.g., "javascript", "python")
- `detect(context)`: returns `true` if provider applies to project
- `getAdapters(context)`: returns the tool adapters owned by this provider
- `run(context, tasks, engine)`: **optional** custom lifecycle (setup + execution)
- `executionOrder`: numeric sort key for provider execution sequence

Planning is performed by adapters (`plan`), not by providers directly. Providers coordinate detection and adapter ownership while the orchestrator routes tasks by `providerId`.

The optional `run()` lifecycle is intentional: providers that need language-specific setup (dependency installation, setup-outcome gating) own that setup and execution without the orchestrator learning language details. Providers without special setup fall back to the generic engine path. This keeps setup coupled to the language that requires it rather than forcing an artificial setup abstraction.

### Adapter

- Tool-specific implementation producing `ExecutionTask[]`
- Detects applicability and plans work for its supported capabilities
- Uses `scope` for capability deduplication and conflict resolution; provider adapters default to `provider.id`, standalone adapters default to an isolated per-adapter scope unless they explicitly match a provider id or shared scope

### ExecutionTask

- `providerId` is optional and identifies owning provider when applicable
- Standalone adapter tasks may omit `providerId`
- `scope`-based deduplication replaces the old `conflictDomain` concept

Current providers:

- `javascript`: Detects via `package.json`; plans via script selection + tool-native fallback; custom `run()` handles `npm install` + execution
- `python`: Detects via project/source detection; plans Ruff lint/format; custom `run()` handles `uv sync`/`pip install` + Ruff execution

## Consequences

### Positive

- **Open/closed**: Add new language by registering a `LanguageProvider` — orchestrator and engine unchanged
- **Single responsibility**: Provider owns domain logic; adapter owns tool logic; engine owns execution mechanics
- **Testability**: Each provider/adapter testable in isolation with mocked context
- **Conflict resolution**: `scope` allows deduplication within a domain (e.g., multiple formatters) without cross-domain interference
- **Custom lifecycles**: Providers with complex setup (JS install, Python sync) implement `run()`; simple providers fall back to engine

### Negative

- **Registry coupling**: Providers must be registered in `defaultRegistry` (single file) — minor coordination point
- **Context shape**: `ProjectContext` must contain all data providers need — evolves as providers are added

### Neutral

- **Standalone adapters**: Can register adapters without a provider (e.g., hypothetical future tool not tied to a language domain) — omit `providerId` and use `scope` for deduplication

## Alternatives Rejected

- **Monolithic executor**: Becomes unmaintainable as languages/tools grow; violates single responsibility; hard to test
- **Plugin system**: Over-engineering for internal ecosystem; dynamic loading adds complexity, security surface, debugging difficulty

## Related

- ADR 0005: Python project detection includes source files
- `src/autofix/types.ts` — `LanguageProvider`, `ExecutionTask`, `ProjectContext`
- `src/autofix/registry.ts` — `defaultRegistry` and provider registration
- `src/autofix/index.ts` — Orchestrator using registry
