# Architecture Decision Records

ADRs live in this directory and are numbered sequentially (`0001-...`). Preserve existing numbering and historical records.

## Lifecycle

- Create a new ADR when a decision is hard to reverse, surprising without context, or the result of a real trade-off.
- Update an existing ADR only for clarification that does not change the decision; note the revision.
- When a decision is replaced, mark the old ADR `Superseded by ADR-NNNN` and add a new ADR rather than rewriting history.
- Keep superseded ADRs available for context.
- Reference related ADRs in each record.

## Index

| ADR  | Topic                       | Link                                                                                                   |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0001 | Composite Actions           | [0001-composite-actions.md](./0001-composite-actions.md)                                               |
| 0002 | Committed `dist/`           | [0002-committed-dist.md](./0002-committed-dist.md)                                                     |
| 0003 | Contradictory Configuration | [0003-validation-fails-on-contradictory-config.md](./0003-validation-fails-on-contradictory-config.md) |
| 0004 | Runtime Precedence          | [0004-runtime-precedence.md](./0004-runtime-precedence.md)                                             |
| 0005 | Python Project Detection    | [0005-python-project-detection.md](./0005-python-project-detection.md)                                 |
| 0006 | uv vs pip                   | [0006-uv-over-pip.md](./0006-uv-over-pip.md)                                                           |
| 0007 | Pure Setup Plan             | [0007-pure-setup-plan.md](./0007-pure-setup-plan.md)                                                   |
| 0008 | Provider/Adapter Pattern    | [0008-provider-adapter-pattern.md](./0008-provider-adapter-pattern.md)                                 |
| 0009 | Vite+ Toolchain             | [0009-vite-plus-only-toolchain.md](./0009-vite-plus-only-toolchain.md)                                 |
| 0010 | uv.toml vs Project Manifest | [0010-uv-toml-not-manifest.md](./0010-uv-toml-not-manifest.md)                                         |

> **Note on dates**: All ADRs currently show **2024-01-15** as the date. This is the date the decisions were recorded in the ADR document format (added in commit 22a5f3a); it may not reflect the original date each decision was made. Do not infer historical accuracy from these dates without supporting evidence.
