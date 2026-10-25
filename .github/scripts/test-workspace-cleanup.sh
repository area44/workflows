#!/usr/bin/env bash
set -euo pipefail

# test-workspace-cleanup.sh: Ownership-aware, failure-safe setup and cleanup for GitHub Actions test matrix runs.
# Commands:
#   setup   <action> <runtime> <pm> <type> [fixture]
#   cleanup

MODE="${1:-}"
STATE_DIR="${TEST_WORKSPACE_STATE_DIR:-.test_workspace_state}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

# Helper to check if a root item is in the allowlist
is_allowed_root_item() {
  local item="${1:-}"
  for allowed in "${ROOT_ITEMS[@]}"; do
    if [[ "$item" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

# Helper to validate that a relative workspace path is safe and stays within CWD
validate_path() {
  local p="${1:-}"
  if [[ -z "$p" || "$p" == /* || "$p" == *".."* ]]; then
    echo "Error: Refusing to operate on unsafe or out-of-bounds path: '$p'" >&2
    return 1
  fi
  return 0
}

# Helper to validate stash path strictly within runner temp base and pattern
validate_stash_path() {
  local p="${1:-}"
  local base="${RUNNER_TEMP:-/tmp}"

  if [[ -z "$p" || "$p" != /* || "$p" == *".."* ]]; then
    echo "Error: Refusing to operate on unsafe or non-absolute stash path: '$p'" >&2
    return 1
  fi

  # Reject symbolic link stash path
  if [ -L "$p" ]; then
    echo "Error: Refusing to operate on stash path '$p' because it is a symbolic link." >&2
    return 1
  fi

  if [ ! -d "$p" ]; then
    echo "Error: Stash directory '$p' does not exist or is not a directory." >&2
    return 1
  fi

  local base_real
  base_real=$(cd "$base" 2>/dev/null && pwd -P || true)
  if [[ -z "$base_real" ]]; then
    echo "Error: Runner temp base directory '$base' does not exist." >&2
    return 1
  fi

  local p_real
  p_real=$(cd "$p" 2>/dev/null && pwd -P || true)
  if [[ -z "$p_real" ]]; then
    echo "Error: Failed to resolve canonical physical path for '$p'." >&2
    return 1
  fi

  local dir_name
  dir_name=$(basename "$p")
  if [[ "$dir_name" != tests_stash_* ]]; then
    echo "Error: Stash directory '$p' does not follow expected 'tests_stash_*' naming pattern." >&2
    return 1
  fi

  local parent_real
  parent_real=$(cd "$(dirname "$p")" 2>/dev/null && pwd -P || true)
  if [[ "$parent_real" != "$base_real" ]]; then
    echo "Error: Stash path '$p' (parent '$parent_real') is outside approved base directory '$base_real'." >&2
    return 1
  fi

  if [[ "$p_real" != "${base_real}/${dir_name}" ]]; then
    echo "Error: Canonical stash path '$p_real' does not match expected path '${base_real}/${dir_name}'." >&2
    return 1
  fi

  return 0
}

if [[ "$MODE" == "setup" ]]; then
  ACTION="${2:-}"
  RUNTIME="${3:-}"
  PM="${4:-}"
  TYPE="${5:-}"
  FIXTURE="${6:-}"

  # Guard state directory collision
  if [ -e "$STATE_DIR" ]; then
    echo "Error: State directory '$STATE_DIR' already exists. Aborting setup to prevent state collision." >&2
    exit 1
  fi

  shopt -s dotglob

  # Prepare isolated temporary staging directory with exclusive ownership
  TMP_FIX_BASE="${RUNNER_TEMP:-/tmp}"
  mkdir -p "$TMP_FIX_BASE"
  TMP_FIX=$(mktemp -d "${TMP_FIX_BASE}/fixture_copy_XXXXXX") || {
    echo "Error: Failed to create safe temporary fixture directory." >&2
    exit 1
  }

  # Ensure temporary staging directory owned by this invocation is always cleaned up on exit
  cleanup_staging_dir() {
    if [ -n "${TMP_FIX:-}" ] && [ -d "$TMP_FIX" ]; then
      rm -rf "$TMP_FIX"
    fi
  }
  trap cleanup_staging_dir EXIT

  IS_DYNAMIC_CONSUMER=false
  FIXTURE_DIR=""
  if [[ "$FIXTURE" == "consumer-project" || "$TYPE" == "consumer-integration" ]]; then
    IS_DYNAMIC_CONSUMER=true
    FIXTURE_DIR="consumer-project (dynamic)"
  fi

  if [[ "$IS_DYNAMIC_CONSUMER" == "true" ]]; then
    node "$REPO_ROOT/.github/scripts/generate-consumer-project.js" "$TMP_FIX" || {
      echo "Error: Failed to generate dynamic consumer project." >&2
      exit 1
    }
  else
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

    cp -r "$FIXTURE_DIR"/* "$TMP_FIX"/ || {
      echo "Error: Failed to copy fixture into temp dir." >&2
      exit 1
    }
  fi

  # Guard reserved local action directories
  for reserved in pages autofix; do
    if [ -e "$TMP_FIX/$reserved" ]; then
      echo "Error: Fixture '${FIXTURE_DIR}' contains reserved local action directory '${reserved}'. Aborting setup to protect action source." >&2
      exit 1
    fi
  done

  mkdir -p "$STATE_DIR" || {
    echo "Error: Failed to create state directory '$STATE_DIR'." >&2
    exit 1
  }

  if [ "${INJECT_FAILURE_BEFORE_SNAPSHOT:-0}" -eq 1 ]; then
    echo "Injected failure before snapshot initialization." >&2
    exit 1
  fi

  # 1. Track __tests__ stash state safely with exclusive directory ownership
  TMP_TESTS_BASE="${RUNNER_TEMP:-/tmp}"
  mkdir -p "$TMP_TESTS_BASE"
  TMP_TESTS=$(mktemp -d "${TMP_TESTS_BASE}/tests_stash_XXXXXX") || {
    echo "Error: Failed to create safe stash directory." >&2
    exit 1
  }
  echo "stash_tests_path=$TMP_TESTS" > "$STATE_DIR/stash.info"

  if [ -d __tests__ ]; then
    echo "tests_existed_before_setup=true" >> "$STATE_DIR/stash.info"
    mv __tests__ "$TMP_TESTS"/ || {
      echo "Error: Failed to stash __tests__ directory." >&2
      exit 1
    }
  else
    echo "tests_existed_before_setup=false" >> "$STATE_DIR/stash.info"
  fi

  if [ "${INJECT_FAILURE_AFTER_STASH:-0}" -eq 1 ]; then
    echo "Injected failure after stashing __tests__." >&2
    exit 1
  fi

  # 2. Snapshot pre-existing items in current working directory
  touch "$STATE_DIR/snapshot_pre_existing_items"
  for item in *; do
    if [ "$item" != "*" ] && [ -e "$item" ] && [ "$item" != "$STATE_DIR" ]; then
      if [ "${INJECT_FAILURE_IN_SNAPSHOT:-0}" -eq 1 ]; then
        echo "Injected failure during snapshot creation." >&2
        exit 1
      fi
      echo "$item" >> "$STATE_DIR/snapshot_pre_existing_items"
    fi
  done

  echo "SNAPSHOT_STATUS=complete" > "$STATE_DIR/snapshot.status"

  # 3. Initialize backup and installation manifests
  touch "$STATE_DIR/backed_up_files"
  touch "$STATE_DIR/installed_fixture_files"

  for item in "${ROOT_ITEMS[@]}"; do
    if [ -e "$item" ]; then
      bak_item="${item}.test_bak_$$"
      if [ -e "$bak_item" ]; then
        echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
        exit 1
      fi
      mv "$item" "$bak_item" || {
        echo "Error: Failed to back up '${item}'." >&2
        exit 1
      }
      echo "${item}|${bak_item}" >> "$STATE_DIR/backed_up_files"
    fi
  done

  # 4. Install fixture files safely and record each installation
  COUNT=0
  if ls -1A "$TMP_FIX" > "$STATE_DIR/fixture_items_list" 2>/dev/null; then
    while IFS= read -r item; do
      [ -z "$item" ] && continue
      COUNT=$((COUNT + 1))

      if [ "${INJECT_FAILURE_IN_COPY:-0}" -eq 1 ] && [ "$COUNT" -gt 1 ]; then
        echo "Injected failure partway through copying fixture files." >&2
        rm -f "$STATE_DIR/fixture_items_list"
        exit 1
      fi

      if [ -e "$item" ]; then
        bak_item="${item}.test_bak_$$"
        if [ -e "$bak_item" ]; then
          echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
          rm -f "$STATE_DIR/fixture_items_list"
          exit 1
        fi
        mv "$item" "$bak_item" || {
          echo "Error: Failed to back up conflicting root item '${item}'." >&2
          rm -f "$STATE_DIR/fixture_items_list"
          exit 1
        }
        echo "${item}|${bak_item}" >> "$STATE_DIR/backed_up_files"
      fi

      cp -r "$TMP_FIX/$item" . || {
        echo "Error: Failed to install fixture item '${item}'." >&2
        rm -f "$STATE_DIR/fixture_items_list"
        exit 1
      }
      echo "$item" >> "$STATE_DIR/installed_fixture_files"
    done < "$STATE_DIR/fixture_items_list"
    rm -f "$STATE_DIR/fixture_items_list"
  fi

  exit 0

elif [[ "$MODE" == "cleanup" ]]; then
  shopt -s dotglob

  # If state directory does not exist, cleanup cannot establish ownership state. Abort path deletion safely.
  if [ ! -d "$STATE_DIR" ]; then
    echo "Notice: Workspace state directory '$STATE_DIR' is missing or incomplete. Skipping path deletion to prevent data loss." >&2
    exit 0
  fi

  HAD_MANIFEST_ERROR=false
  HAD_RESTORE_FAILURE=false

  # Pre-validate installed_fixture_files manifest atomically before any deletion
  if [ -f "$STATE_DIR/installed_fixture_files" ]; then
    while IFS= read -r item; do
      [ -z "$item" ] && continue
      if ! validate_path "$item" || [[ "$item" == *"/"* ]]; then
        echo "Error: Installed fixture manifest contains invalid or nested path '$item'. Failing closed." >&2
        HAD_MANIFEST_ERROR=true
        break
      fi
    done < "$STATE_DIR/installed_fixture_files"
  fi

  # 1. Remove fixture installed files recorded during setup (only if manifest validation passed)
  if [ "$HAD_MANIFEST_ERROR" == "false" ] && [ -f "$STATE_DIR/installed_fixture_files" ]; then
    while IFS= read -r item; do
      if [ -n "$item" ] && validate_path "$item"; then
        rm -rf "$item"
      fi
    done < "$STATE_DIR/installed_fixture_files"
  fi

  # 2. Clean up workflow-generated paths/artifacts ONLY if snapshot status is 'complete'
  SNAPSHOT_COMPLETE=false
  if [ -f "$STATE_DIR/snapshot.status" ]; then
    if grep -Fqx "SNAPSHOT_STATUS=complete" "$STATE_DIR/snapshot.status" 2>/dev/null; then
      SNAPSHOT_COMPLETE=true
    fi
  fi

  if [ "$SNAPSHOT_COMPLETE" == "true" ] && [ "$HAD_MANIFEST_ERROR" == "false" ]; then
    GENERATED_PATHS=(node_modules dist .venv .ruff_cache *.egg-info)
    for pattern in "${GENERATED_PATHS[@]}"; do
      for path in $pattern; do
        [ "$path" == "$pattern" ] && [ ! -e "$path" ] && continue
        [ ! -e "$path" ] && continue
        [ "$path" == "$STATE_DIR" ] && continue

        # Verify path was NOT pre-existing before setup
        IS_PRE_EXISTING=false
        if [ -f "$STATE_DIR/snapshot_pre_existing_items" ]; then
          if grep -Fqx "$path" "$STATE_DIR/snapshot_pre_existing_items" 2>/dev/null; then
            IS_PRE_EXISTING=true
          fi
        fi

        if [ "$IS_PRE_EXISTING" == "false" ] && validate_path "$path"; then
          rm -rf "$path"
        fi
      done
    done
  else
    echo "Notice: Snapshot is missing, incomplete, or state is invalid. Preserving generated paths to prevent data loss." >&2
  fi

  # 3. Restore backed up root items recorded in backed_up_files (ATOMIC PRE-VALIDATION)
  if [ -f "$STATE_DIR/backed_up_files" ]; then
    valid_orig_items=()
    valid_bak_items=()
    declare -A seen_orig_items=()
    declare -A seen_bak_items=()

    # Phase 1: Atomically validate all records in backed_up_files
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "$line" ] && continue

      # Must contain exactly one pipe delimiter
      if [[ "$line" != *"|"* ]] || [[ "$line" == *"|"*'|'* ]]; then
        echo "Error: Malformed record in backed_up_files (invalid delimiter): '$line'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      IFS='|' read -r orig_item bak_item <<< "$line"

      if [ -z "$orig_item" ] || [ -z "$bak_item" ]; then
        echo "Error: Missing item in backup mapping: '$line'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      if ! validate_path "$orig_item" || [[ "$orig_item" == *"/"* ]]; then
        echo "Error: Unsafe original path in backup mapping: '$orig_item'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      if ! validate_path "$bak_item" || [[ "$bak_item" == *"/"* ]]; then
        echo "Error: Unsafe backup path in backup mapping: '$bak_item'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      if ! is_allowed_root_item "$orig_item"; then
        echo "Error: Unallowed root item in backed_up_files: '$orig_item'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      # Backup path suffix must contain only numbers and match expected pattern
      if [[ ! "$bak_item" =~ ^${orig_item}\.test_bak_[0-9]+$ ]]; then
        echo "Error: Mismatched backup filename pattern for '$orig_item': '$bak_item'." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      if [ -n "${seen_orig_items[$orig_item]:-}" ]; then
        echo "Error: Duplicate original item entry for '$orig_item' in backed_up_files." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      if [ -n "${seen_bak_items[$bak_item]:-}" ]; then
        echo "Error: Duplicate backup item entry for '$bak_item' in backed_up_files." >&2
        HAD_RESTORE_FAILURE=true
        break
      fi

      seen_orig_items["$orig_item"]=1
      seen_bak_items["$bak_item"]=1
      valid_orig_items+=("$orig_item")
      valid_bak_items+=("$bak_item")
    done < "$STATE_DIR/backed_up_files"

    # Phase 2: Perform restoration ONLY if atomic pre-validation passed with zero errors
    if [ "$HAD_RESTORE_FAILURE" == "false" ]; then
      for i in "${!valid_orig_items[@]}"; do
        orig_item="${valid_orig_items[$i]}"
        bak_item="${valid_bak_items[$i]}"

        if [ -e "$bak_item" ]; then
          if [ "${INJECT_FAILURE_RESTORE:-0}" -eq 1 ] || [ "${INJECT_FAILURE_RESTORE_ITEM:-}" == "$orig_item" ]; then
            echo "Error: Injected failure restoring '$bak_item' to '$orig_item'." >&2
            HAD_RESTORE_FAILURE=true
            continue
          fi

          rm -rf "$orig_item"
          if ! mv "$bak_item" "$orig_item"; then
            echo "Warning: Failed to restore backup '$bak_item' to '$orig_item'. Preserving backup file for recovery." >&2
            HAD_RESTORE_FAILURE=true
          fi
        fi
      done
    else
      echo "Notice: Aborting backup restoration due to manifest validation failures. Preserving backup files for recovery." >&2
    fi
  fi

  # 4. Restore stashed __tests__ directory
  if [ -f "$STATE_DIR/stash.info" ]; then
    STASH_PATH=$(grep "^stash_tests_path=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)
    TESTS_EXISTED=$(grep "^tests_existed_before_setup=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)

    if [[ "$TESTS_EXISTED" == "true" ]]; then
      if [ -n "$STASH_PATH" ] && validate_stash_path "$STASH_PATH"; then
        stashed_tests="${STASH_PATH}/__tests__"
        if [ -d "$stashed_tests" ] && [ ! -L "$stashed_tests" ]; then
          if [ "${INJECT_FAILURE_RESTORE:-0}" -eq 1 ]; then
            echo "Error: Injected failure restoring stashed __tests__." >&2
            HAD_RESTORE_FAILURE=true
          else
            rm -rf __tests__
            if mv "$stashed_tests" .; then
              rm -rf "$STASH_PATH"
            else
              echo "Error: Failed to restore stashed __tests__ from '$stashed_tests'. Preserving stash directory for recovery." >&2
              HAD_RESTORE_FAILURE=true
            fi
          fi
        else
          echo "Error: Stashed __tests__ directory at '$stashed_tests' is missing, not a directory, or is a symbolic link." >&2
          HAD_RESTORE_FAILURE=true
        fi
      else
        echo "Error: Invalid or missing stashed __tests__ directory at '$STASH_PATH'." >&2
        HAD_RESTORE_FAILURE=true
      fi
    elif [[ "$TESTS_EXISTED" == "false" ]]; then
      # __tests__ did not exist before setup. Remove any test-created __tests__ directory safely.
      rm -rf __tests__
      if [ -n "$STASH_PATH" ] && validate_stash_path "$STASH_PATH" && [ -d "$STASH_PATH" ]; then
        rm -rf "$STASH_PATH"
      fi
    else
      echo "Error: Invalid or missing tests_existed_before_setup state in stash.info: '$TESTS_EXISTED'. Preserving __tests__." >&2
      HAD_RESTORE_FAILURE=true
    fi
  fi

  # Only remove STATE_DIR if all restorations and manifest checks succeeded
  if [ "$HAD_RESTORE_FAILURE" == "false" ] && [ "$HAD_MANIFEST_ERROR" == "false" ]; then
    rm -rf "$STATE_DIR"
  else
    echo "Warning: Cleanup or restoration encountered errors. Preserving state directory '$STATE_DIR' for recovery." >&2
  fi

  exit 0

else
  echo "Usage: $0 {setup|cleanup} [args...]" >&2
  exit 1
fi
