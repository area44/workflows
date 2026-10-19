---
"@area44/workflows": patch
---

refactor(pages): streamline build command execution, BASE/BASE_URL support, and build output validation

- Prevented raw user-configured build commands and parameter vectors from being logged or embedded in action error messages.
- Added independent support for `BASE` and `BASE_URL` environment variables with shared normalization rules, absolute URL rejection, and conflict detection.
- Enforced strict origin validation for `SITE`, rejecting query parameters and fragments.
- Hardened build output directory validation and expanded unit test coverage across build command execution and site variables.
- Updated Pages action documentation with base path normalization rules and examples.
