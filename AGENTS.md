# Project Overview

This repository contains reusable GitHub Actions workflows and composite actions (Astro, Vite, Vite-Plus, Lint-Format) for the AREA44 ecosystem.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Rust Migration Research

In response to inquiries about migrating these TypeScript utilities to Rust for performance:

- **Findings:** A Rust proof-of-concept for `detect-env` showed execution times of ~15ms compared to ~100ms for the TypeScript/Node.js version.
- **Conclusion:** The ~85ms saving is negligible in the context of typical CI workflows (which run for minutes).
- **Trade-offs:** Migrating would introduce significant complexity in cross-platform binary distribution and maintenance.
- **Recommendation:** Retain the TypeScript implementation for ease of maintenance and alignment with the Vite+ ecosystem.
