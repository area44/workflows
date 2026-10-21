---
"@area44/workflows": major
---

Remove legacy string-based Python installCommand property and resolvePythonInstallCommands fallback interpreter in favor of canonical structured installCommands arrays.

BREAKING CHANGE: The legacy `installCommand` string property on Python environment metadata is removed. Python package manager detection, validation, and autofix dependency execution strictly enforce structured `installCommands` argument arrays.
