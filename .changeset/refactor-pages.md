---
"@area44/workflows": patch
---

refactor(pages): automatically resolve SITE, BASE, and BASE_URL from GitHub context

- Automatically resolve `SITE`, `BASE`, and `BASE_URL` environment variables from GitHub repository context (`GITHUB_REPOSITORY` and `GITHUB_REPOSITORY_OWNER`).
- Removed external user input configuration, URL validation, and normalization logic for `SITE`, `BASE`, and `BASE_URL`.
- Hardened build output directory validation and error reporting.
- Updated Pages action documentation and tests to reflect automatic site variable resolution.
