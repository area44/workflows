#!/usr/bin/env bash
set -e

if [ ! -f "package.json" ]; then
  echo "No package.json found. Skipping scripts."
  exit 0
fi

PM="${PACKAGE_MANAGER:-npm}"

HAS_CHECK=$(jq -r '.scripts.check // empty' package.json 2>/dev/null || true)
HAS_FORMAT=$(jq -r '.scripts.format // empty' package.json 2>/dev/null || true)
HAS_FMT=$(jq -r '.scripts.fmt // empty' package.json 2>/dev/null || true)
HAS_LINT=$(jq -r '.scripts.lint // empty' package.json 2>/dev/null || true)

run_cmd() {
  local script_name="$1"
  echo "Executing: $PM run $script_name"
  if ! "$PM" run "$script_name"; then
    echo "Script \"$script_name\" failed" >&2
    exit 1
  fi
}

if [ -n "$HAS_CHECK" ]; then
  echo "Detected and executed script: check"
  run_cmd "check"
elif [ -n "$HAS_FORMAT" ] && [ -n "$HAS_LINT" ]; then
  echo "Detected lint/format scripts: format, lint"
  run_cmd "format"
  run_cmd "lint"
elif [ -n "$HAS_FMT" ] && [ -n "$HAS_LINT" ]; then
  echo "Detected lint/format scripts: fmt, lint"
  run_cmd "fmt"
  run_cmd "lint"
elif [ -n "$HAS_FORMAT" ]; then
  run_cmd "format"
elif [ -n "$HAS_FMT" ]; then
  run_cmd "fmt"
elif [ -n "$HAS_LINT" ]; then
  run_cmd "lint"
else
  echo "No matching scripts (check, format, lint, etc.) found in package.json."
fi
