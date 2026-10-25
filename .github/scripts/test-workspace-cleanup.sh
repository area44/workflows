#!/usr/bin/env bash
set -euo pipefail

# test-workspace-cleanup.sh: Ownership-aware, failure-safe setup and cleanup for GitHub Actions test matrix runs.
# Commands:
#   setup   <action> <runtime> <pm> <type> [fixture]
#   cleanup

MODE="${1:-}"

if [[ "$MODE" == "setup" ]]; then
  ACTION="${2:-}"
  RUNTIME="${3:-}"
  PM="${4:-}"
  TYPE="${5:-}"
  FIXTURE="${6:-}"

  if [ -n "$FIXTURE" ]; then
    if [[ "$FIXTURE" == /* ]]; then
      FIXTURE_DIR="$FIXTURE"
    else
      FIXTURE_DIR="__tests__/fixtures/${FIXTURE}"
    fi
  else
    FIXTURE_DIR="__tests__/fixtures/${ACTION}/${RUNTIME}/${PM}/${TYPE}"
  fi

  if [ ! -d "$FIXTURE_DIR" ]; then
    echo "Error: Missing expected fixture directory for matrix combination '${ACTION} (${RUNTIME}, ${PM}, ${TYPE})': $FIXTURE_DIR" >&2
    exit 1
  fi

  shopt -s dotglob

  # 1. Create temporary fixture directory safely
  TMP_FIX="${RUNNER_TEMP:-/tmp}/fixture_copy_$$"
  mkdir -p "$TMP_FIX" || { echo "Error: Failed to create temp fixture directory." >&2; exit 1; }

  cp -r "$FIXTURE_DIR"/* "$TMP_FIX"/ || {
    echo "Error: Failed to copy fixture into temp dir." >&2
    rm -rf "$TMP_FIX"
    exit 1
  }

  # Guard reserved local action directories
  for reserved in pages autofix; do
    if [ -e "$TMP_FIX/$reserved" ]; then
      echo "Error: Fixture '${FIXTURE_DIR}' contains reserved local action directory '${reserved}'. Aborting setup to protect action source." >&2
      rm -rf "$TMP_FIX"
      exit 1
    fi
  done

  # 2. Track __tests__ stash state safely
  # Store stash dir location and whether original __tests__ directory existed
  TMP_TESTS="${RUNNER_TEMP:-/tmp}/tests_stash_$$"
  if mkdir -p "$TMP_TESTS"; then
    echo "$TMP_TESTS" > .stash_tests_path
  else
    echo "Error: Failed to create stash directory '$TMP_TESTS'." >&2
    rm -rf "$TMP_FIX"
    exit 1
  fi

  if [ -d __tests__ ]; then
    echo "true" > .tests_existed_before_setup
    mv __tests__ "$TMP_TESTS"/__tests__ || {
      echo "Error: Failed to stash __tests__ directory." >&2
      rm -rf "$TMP_FIX" "$TMP_TESTS"
      rm -f .stash_tests_path .tests_existed_before_setup
      exit 1
    }
  else
    echo "false" > .tests_existed_before_setup
  fi

  # 3. Initialize state manifests safely
  touch .backed_up_files
  touch .installed_fixture_files
  touch .snapshot_pre_existing_items

  # Snapshot pre-existing items in the current working directory before copying fixture
  for item in *; do
    if [ "$item" != "*" ] && [ -e "$item" ]; then
      echo "$item" >> .snapshot_pre_existing_items
    fi
  done

  ROOT_ITEMS=(
    package.json
    package-lock.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    bun.lock
    tsconfig.json
    vite.config.ts
    astro.config.mjs
    index.html
    main.py
    app.py
    .node-version
    .bun-version
    .python-version
    pyproject.toml
    requirements.txt
    uv.lock
    uv.toml
    runtime.txt
    setup.py
    setup.cfg
  )

  for item in "${ROOT_ITEMS[@]}"; do
    if [ -e "$item" ]; then
      bak_item="${item}.test_bak_$$"
      if [ -e "$bak_item" ]; then
        echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
        rm -rf "$TMP_FIX"
        exit 1
      fi
      mv "$item" "$bak_item" || {
        echo "Error: Failed to back up '${item}'." >&2
        rm -rf "$TMP_FIX"
        exit 1
      }
      echo "${item}|${bak_item}" >> .backed_up_files
    fi
  done

  # 4. Install fixture files safely and record each installation
  if ls -1A "$TMP_FIX" > .fixture_items_list 2>/dev/null; then
    while IFS= read -r item; do
      [ -z "$item" ] && continue
      if [ -e "$item" ]; then
        bak_item="${item}.test_bak_$$"
        if [ -e "$bak_item" ]; then
          echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
          rm -rf "$TMP_FIX"
          exit 1
        fi
        mv "$item" "$bak_item" || {
          echo "Error: Failed to back up conflicting root item '${item}'." >&2
          rm -rf "$TMP_FIX"
          exit 1
        }
        echo "${item}|${bak_item}" >> .backed_up_files
      fi

      cp -r "$TMP_FIX/$item" . || {
        echo "Error: Failed to install fixture item '${item}'." >&2
        rm -rf "$TMP_FIX"
        exit 1
      }
      echo "$item" >> .installed_fixture_files
    done < .fixture_items_list
    rm -f .fixture_items_list
  fi

  rm -rf "$TMP_FIX"
  exit 0

elif [[ "$MODE" == "cleanup" ]]; then
  shopt -s dotglob

  # 1. Remove fixture installed files recorded during setup
  if [ -f .installed_fixture_files ]; then
    while IFS= read -r item; do
      if [ -n "$item" ]; then
        rm -rf "$item"
      fi
    done < .installed_fixture_files
    rm -f .installed_fixture_files
  fi

  # 2. Clean up workflow-generated paths/artifacts ONLY if they were NOT pre-existing before setup
  GENERATED_PATHS=(node_modules dist .venv .ruff_cache *.egg-info)
  for pattern in "${GENERATED_PATHS[@]}"; do
    for path in $pattern; do
      # Avoid glob literal when no match
      [ "$path" == "$pattern" ] && [ ! -e "$path" ] && continue
      [ ! -e "$path" ] && continue

      # Check if path was pre-existing before setup
      IS_PRE_EXISTING=false
      if [ -f .snapshot_pre_existing_items ]; then
        if grep -Fqx "$path" .snapshot_pre_existing_items 2>/dev/null; then
          IS_PRE_EXISTING=true
        fi
      fi

      if [ "$IS_PRE_EXISTING" == "false" ]; then
        rm -rf "$path"
      fi
    done
  done

  # 3. Restore backed up root items recorded in .backed_up_files
  if [ -f .backed_up_files ]; then
    # Read backed_up_files in reverse order or standard order safely
    while IFS='|' read -r orig_item bak_item; do
      if [ -n "$orig_item" ] && [ -n "$bak_item" ]; then
        if [ -e "$bak_item" ]; then
          # Ensure current path is removed before restoring backup
          rm -rf "$orig_item"
          if ! mv "$bak_item" "$orig_item"; then
            echo "Warning: Failed to restore backup '$bak_item' to '$orig_item'. Preserving backup file for recovery." >&2
          fi
        fi
      fi
    done < .backed_up_files
    rm -f .backed_up_files
  fi

  # Remove state manifests
  rm -f .snapshot_pre_existing_items .fixture_items_list

  # 4. Restore stashed __tests__ directory
  if [ -f .stash_tests_path ]; then
    STASH_PATH=$(cat .stash_tests_path 2>/dev/null || true)
    TESTS_EXISTED="true"
    if [ -f .tests_existed_before_setup ]; then
      TESTS_EXISTED=$(cat .tests_existed_before_setup 2>/dev/null || true)
    fi

    if [ "$TESTS_EXISTED" == "true" ]; then
      if [ -n "$STASH_PATH" ] && [ -d "$STASH_PATH/__tests__" ]; then
        rm -rf __tests__
        if mv "$STASH_PATH/__tests__" __tests__; then
          rm -rf "$STASH_PATH"
          rm -f .stash_tests_path .tests_existed_before_setup
        else
          echo "Error: Failed to restore stashed __tests__ from '$STASH_PATH'. Preserving stash directory for recovery." >&2
        fi
      fi
    else
      # __tests__ did not exist before setup. Remove any test-created __tests__ directory safely.
      rm -rf __tests__
      if [ -n "$STASH_PATH" ] && [ -d "$STASH_PATH" ]; then
        rm -rf "$STASH_PATH"
      fi
      rm -f .stash_tests_path .tests_existed_before_setup
    fi
  fi

  exit 0

else
  echo "Usage: $0 {setup|cleanup} [args...]" >&2
  exit 1
fi
