---
"@area44/workflows": patch
---

Fix remaining review issues in PR #236: enhance secret sanitization to redact quoted flag values, sensitive environment variable assignments, Bearer tokens, and URL credentials; capture and sanitize child-process stdout/stderr in `autofix`; and add regression test coverage.
