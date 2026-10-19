---
"@area44/workflows": patch
---

refactor(pages): streamline build command resolution, output validation, and SITE/BASE semantics

- Streamlined build command resolution, parsing, execution, and output directory validation in `src/pages/build-command.ts`.
- Refactored `SITE` and `BASE` resolution in `src/pages/site-variables.ts` to support explicit environment overrides with scheme validation for `SITE` and slash normalization for `BASE`.
- Expanded test coverage for build output validation failure modes and site variable resolution.
- Updated Pages action documentation for environment variables.
