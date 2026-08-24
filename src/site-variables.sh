#!/usr/bin/env bash
set -e

ACTION_PATH="${GITHUB_ACTION_PATH:-}"
ACTION_NAME=$(basename "$ACTION_PATH" 2>/dev/null || true)
REPO_FULL="${GITHUB_REPOSITORY:-}"
OWNER="${GITHUB_REPOSITORY_OWNER:-}"
REPO="${REPO_FULL#*/}"

if [ -z "$OWNER" ] || [ -z "$REPO_FULL" ] || [ "$REPO_FULL" = "$OWNER" ]; then
  echo "GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables."
  exit 0
fi

SITE="https://${OWNER}.github.io"
if [ "$REPO" = "${OWNER}.github.io" ]; then
  BASE="/"
else
  BASE="/${REPO}/"
fi

if [ "$ACTION_NAME" = "astro" ] || [ "$ACTION_NAME" = "vite" ] || [ "$ACTION_NAME" = "vite-plus" ]; then
  if [ -n "$GITHUB_ENV" ]; then
    echo "SITE=${SITE}" >> "$GITHUB_ENV"
    echo "BASE=${BASE}" >> "$GITHUB_ENV"
  fi
  echo "Set SITE=${SITE}"
  echo "Set BASE=${BASE}"
fi
