#!/usr/bin/env bash
set -euo pipefail

# test-workspace-cleanup.sh: Ownership-aware, failure-safe setup and cleanup for GitHub Actions test matrix runs.
# Commands:
#   setup   <action> <runtime> <pm> <type> [fixture]
#   cleanup

MODE="${1:-}"
STATE_DIR="${TEST_WORKSPACE_STATE_DIR:-.test_workspace_state}"
WORKSPACE_ROOT="$(pwd -P)"

# Helper to validate that a relative workspace path is safe and stays within CWD
validate_workspace_path() {
  local p="$1"
  if [ -z "$p" ]; then
    echo "Error: Refusing empty path." >&2
    return 1
  fi

  if [[ "$p" == /* ]]; then
    echo "Error: Refusing absolute path: '$p'" >&2
    return 1
  fi

  if [[ "$p" == *".."* ]]; then
    echo "Error: Refusing path with traversal: '$p'" >&2
    return 1
  fi

  local top_item="${p%%/*}"
  case "$top_item" in
    .git|.github|pages|autofix|"$STATE_DIR")
      echo "Error: Refusing operation on reserved root item: '$p'" >&2
      return 1
      ;;
  esac

  local canonical
  canonical="$(realpath -m "$p" 2>/dev/null || true)"
  if [ -z "$canonical" ]; then
    echo "Error: Unable to resolve canonical path for '$p'" >&2
    return 1
  fi

  if [[ "$canonical" != "$WORKSPACE_ROOT" && "$canonical" != "$WORKSPACE_ROOT/"* ]]; then
    echo "Error: Canonical path '$canonical' escapes workspace root '$WORKSPACE_ROOT'" >&2
    return 1
  fi

  return 0
}

# Helper to validate stash path
validate_stash_path() {
  local p="$1"
  if [ -z "$p" ]; then
    echo "Error: Refusing empty stash path." >&2
    return 1
  fi

  local base_name
  base_name="$(basename "$p")"
  if [[ ! "$base_name" =~ ^tests_stash_[0-9]+$ ]]; then
    echo "Error: Invalid stash path naming convention: '$p'" >&2
    return 1
  fi

  local runner_temp_canonical
  runner_temp_canonical="$(realpath "${RUNNER_TEMP:-/tmp}" 2>/dev/null || true)"
  local stash_canonical
  stash_canonical="$(realpath -m "$p" 2>/dev/null || true)"

  if [ -z "$runner_temp_canonical" ] || [ -z "$stash_canonical" ]; then
    echo "Error: Unable to resolve stash paths." >&2
    return 1
  fi

  if [[ "$stash_canonical" != "$runner_temp_canonical/"* ]]; then
    echo "Error: Stash path '$stash_canonical' does not reside within RUNNER_TEMP '$runner_temp_canonical'." >&2
    return 1
  fi

  return 0
}

validate_backed_up_files_manifest() {
  local manifest="$STATE_DIR/backed_up_files"
  if [ ! -f "$manifest" ]; then
    if [[ "${LIFECYCLE_STAGE:-}" == "setup_complete" || "${LIFECYCLE_STAGE:-}" == "snapshot_complete" ]]; then
      echo "Error: Required backed_up_files manifest is missing." >&2
      return 1
    fi
    return 0
  fi

  local seen_orig=()
  local seen_bak=()

  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue

    local pipe_count
    pipe_count=$(tr -dc '|' <<< "$line" | wc -c)
    if [ "$pipe_count" -ne 1 ]; then
      echo "Error: Invalid line format in backed_up_files (expected single '|'): '$line'" >&2
      return 1
    fi

    local orig_item bak_item
    orig_item="${line%%|*}"
    bak_item="${line#*|}"

    if [ -z "$orig_item" ] || [ -z "$bak_item" ]; then
      echo "Error: Empty field in backed_up_files record: '$line'" >&2
      return 1
    fi

    if [[ "$orig_item" == *"/"* ]]; then
      echo "Error: Backup original item must be top-level root path: '$orig_item'" >&2
      return 1
    fi

    if ! validate_workspace_path "$orig_item"; then
      echo "Error: Unsafe original item in backed_up_files: '$orig_item'" >&2
      return 1
    fi

    if [[ ! "$bak_item" =~ ^${orig_item}\.test_bak_[0-9]+$ ]]; then
      echo "Error: Backup item does not match naming convention: '$bak_item'" >&2
      return 1
    fi

    if ! validate_workspace_path "$bak_item"; then
      echo "Error: Unsafe backup item in backed_up_files: '$bak_item'" >&2
      return 1
    fi

    for seen in "${seen_orig[@]}"; do
      if [ "$seen" == "$orig_item" ]; then
        echo "Error: Duplicate original item mapping in backed_up_files: '$orig_item'" >&2
        return 1
      fi
    done
    for seen in "${seen_bak[@]}"; do
      if [ "$seen" == "$bak_item" ]; then
        echo "Error: Duplicate backup item mapping in backed_up_files: '$bak_item'" >&2
        return 1
      fi
    done

    seen_orig+=("$orig_item")
    seen_bak+=("$bak_item")
  done < "$manifest"

  return 0
}

validate_installed_fixture_files_manifest() {
  local manifest="$STATE_DIR/installed_fixture_files"
  if [ ! -f "$manifest" ]; then
    if [[ "${LIFECYCLE_STAGE:-}" == "setup_complete" || "${LIFECYCLE_STAGE:-}" == "snapshot_complete" ]]; then
      echo "Error: Required installed_fixture_files manifest is missing." >&2
      return 1
    fi
    return 0
  fi

  local seen_items=()

  while IFS= read -r item || [ -n "$item" ]; do
    [ -z "$item" ] && continue

    if ! validate_workspace_path "$item"; then
      echo "Error: Unsafe item in installed_fixture_files: '$item'" >&2
      return 1
    fi

    for seen in "${seen_items[@]}"; do
      if [ "$seen" == "$item" ]; then
        echo "Error: Duplicate item in installed_fixture_files: '$item'" >&2
        return 1
      fi
    done

    seen_items+=("$item")
  done < "$manifest"

  return 0
}

validate_snapshot_status_and_items() {
  local status_file="$STATE_DIR/snapshot.status"
  local items_file="$STATE_DIR/snapshot_pre_existing_items"

  if [ ! -f "$status_file" ] || [ ! -f "$items_file" ]; then
    return 1
  fi

  local status_content
  status_content="$(cat "$status_file")"
  if [ "$status_content" != "SNAPSHOT_STATUS=complete" ]; then
    echo "Error: Malformed or incomplete snapshot status." >&2
    return 1
  fi

  while IFS= read -r item || [ -n "$item" ]; do
    [ -z "$item" ] && continue
    if ! validate_workspace_path "$item"; then
      echo "Error: Invalid pre-existing item in snapshot: '$item'" >&2
      return 1
    fi
  done < "$items_file"

  return 0
}

validate_stash_info() {
  local stash_file="$STATE_DIR/stash.info"
  if [ ! -f "$stash_file" ]; then
    return 1
  fi

  local stash_path=""
  local tests_existed=""

  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue

    if [[ "$line" == stash_tests_path=* ]]; then
      if [ -n "$stash_path" ]; then
        echo "Error: Duplicate stash_tests_path in stash.info." >&2
        return 1
      fi
      stash_path="${line#stash_tests_path=}"
    elif [[ "$line" == tests_existed_before_setup=* ]]; then
      if [ -n "$tests_existed" ]; then
        echo "Error: Duplicate tests_existed_before_setup in stash.info." >&2
        return 1
      fi
      tests_existed="${line#tests_existed_before_setup=}"
    else
      echo "Error: Unexpected key in stash.info: '$line'" >&2
      return 1
    fi
  done < "$stash_file"

  if [ -z "$stash_path" ] || [ -z "$tests_existed" ]; then
    echo "Error: Incomplete stash.info." >&2
    return 1
  fi

  if [[ "$tests_existed" != "true" && "$tests_existed" != "false" ]]; then
    echo "Error: Invalid tests_existed_before_setup value: '$tests_existed'" >&2
    return 1
  fi

  if ! validate_stash_path "$stash_path"; then
    echo "Error: Invalid stash_tests_path: '$stash_path'" >&2
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

  TMP_FIX="${RUNNER_TEMP:-/tmp}/fixture_copy_$$"
  mkdir -p "$TMP_FIX" || { echo "Error: Failed to create temp fixture directory." >&2; exit 1; }

  cp -r "$FIXTURE_DIR"/* "$TMP_FIX"/ || {
    echo "Error: Failed to copy fixture into temp dir." >&2
    rm -rf "$TMP_FIX"
    exit 1
  }

  for reserved in pages autofix; do
    if [ -e "$TMP_FIX/$reserved" ]; then
      echo "Error: Fixture '${FIXTURE_DIR}' contains reserved local action directory '${reserved}'. Aborting setup to protect action source." >&2
      rm -rf "$TMP_FIX"
      exit 1
    fi
  done

  mkdir -p "$STATE_DIR" || {
    echo "Error: Failed to create state directory '$STATE_DIR'." >&2
    rm -rf "$TMP_FIX"
    exit 1
  }

  echo "stage=setup_started" > "$STATE_DIR/lifecycle.status"

  if [ "${INJECT_FAILURE_BEFORE_SNAPSHOT:-0}" -eq 1 ]; then
    echo "Injected failure before snapshot initialization." >&2
    rm -rf "$TMP_FIX"
    exit 1
  fi

  # 1. Track __tests__ stash state safely
  TMP_TESTS="${RUNNER_TEMP:-/tmp}/tests_stash_$$"
  if mkdir -p "$TMP_TESTS"; then
    echo "stash_tests_path=$TMP_TESTS" > "$STATE_DIR/stash.info"
  else
    echo "Error: Failed to create stash directory '$TMP_TESTS'." >&2
    rm -rf "$TMP_FIX"
    exit 1
  fi

  if [ -d __tests__ ]; then
    echo "tests_existed_before_setup=true" >> "$STATE_DIR/stash.info"
    mv __tests__ "$TMP_TESTS"/ || {
      echo "Error: Failed to stash __tests__ directory." >&2
      rm -rf "$TMP_FIX"
      exit 1
    }
  else
    echo "tests_existed_before_setup=false" >> "$STATE_DIR/stash.info"
  fi

  echo "stage=stashed" > "$STATE_DIR/lifecycle.status"

  if [ "${INJECT_FAILURE_AFTER_STASH:-0}" -eq 1 ]; then
    echo "Injected failure after stashing __tests__." >&2
    rm -rf "$TMP_FIX"
    exit 1
  fi

  # 2. Snapshot pre-existing items in current working directory
  touch "$STATE_DIR/snapshot_pre_existing_items"
  for item in *; do
    if [ "$item" != "*" ] && [ -e "$item" ] && [ "$item" != "$STATE_DIR" ]; then
      if [ "${INJECT_FAILURE_IN_SNAPSHOT:-0}" -eq 1 ]; then
        echo "Injected failure during snapshot creation." >&2
        rm -rf "$TMP_FIX"
        exit 1
      fi
      echo "$item" >> "$STATE_DIR/snapshot_pre_existing_items"
    fi
  done

  echo "SNAPSHOT_STATUS=complete" > "$STATE_DIR/snapshot.status"
  echo "stage=snapshot_complete" > "$STATE_DIR/lifecycle.status"

  # 3. Initialize backup and installation manifests
  touch "$STATE_DIR/backed_up_files"
  touch "$STATE_DIR/installed_fixture_files"

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
        rm -rf "$TMP_FIX"
        exit 1
      fi

      if [ -e "$item" ]; then
        bak_item="${item}.test_bak_$$"
        if [ -e "$bak_item" ]; then
          echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
          rm -f "$STATE_DIR/fixture_items_list"
          rm -rf "$TMP_FIX"
          exit 1
        fi
        mv "$item" "$bak_item" || {
          echo "Error: Failed to back up conflicting root item '${item}'." >&2
          rm -f "$STATE_DIR/fixture_items_list"
          rm -rf "$TMP_FIX"
          exit 1
        }
        echo "${item}|${bak_item}" >> "$STATE_DIR/backed_up_files"
      fi

      cp -r "$TMP_FIX/$item" . || {
        echo "Error: Failed to install fixture item '${item}'." >&2
        rm -f "$STATE_DIR/fixture_items_list"
        rm -rf "$TMP_FIX"
        exit 1
      }
      echo "$item" >> "$STATE_DIR/installed_fixture_files"
    done < "$STATE_DIR/fixture_items_list"
    rm -f "$STATE_DIR/fixture_items_list"
  fi

  echo "stage=setup_complete" > "$STATE_DIR/lifecycle.status"
  rm -rf "$TMP_FIX"
  exit 0

elif [[ "$MODE" == "cleanup" ]]; then
  shopt -s dotglob

  if [ ! -d "$STATE_DIR" ]; then
    echo "Notice: Workspace state directory '$STATE_DIR' is missing or incomplete. Skipping path deletion to prevent data loss." >&2
    exit 0
  fi

  LIFECYCLE_STAGE=""
  if [ -f "$STATE_DIR/lifecycle.status" ]; then
    LIFECYCLE_STAGE="$(grep "^stage=" "$STATE_DIR/lifecycle.status" 2>/dev/null | cut -d'=' -f2- || true)"
  fi

  HAD_MANIFEST_ERROR=false
  HAD_RESTORE_FAILURE=false

  # Pre-validate all manifests before executing destructive operations
  if ! validate_installed_fixture_files_manifest; then
    echo "Error: Installed fixture manifest contains invalid records. Failing closed." >&2
    HAD_MANIFEST_ERROR=true
  fi

  if ! validate_backed_up_files_manifest; then
    echo "Error: Backed up files manifest contains invalid records. Failing closed." >&2
    HAD_MANIFEST_ERROR=true
  fi

  SNAPSHOT_VALID=false
  if validate_snapshot_status_and_items; then
    SNAPSHOT_VALID=true
  fi

  STASH_INFO_VALID=false
  if validate_stash_info; then
    STASH_INFO_VALID=true
  fi

  # 1. Remove fixture installed files recorded during setup (only if manifests are valid)
  if [ "$HAD_MANIFEST_ERROR" == "false" ] && [ -f "$STATE_DIR/installed_fixture_files" ]; then
    while IFS= read -r item || [ -n "$item" ]; do
      if [ -n "$item" ] && validate_workspace_path "$item"; then
        rm -rf "$item"
      fi
    done < "$STATE_DIR/installed_fixture_files"
  fi

  # 2. Clean up workflow-generated paths/artifacts ONLY if snapshot is strictly valid and manifests pass
  if [ "$SNAPSHOT_VALID" == "true" ] && [ "$HAD_MANIFEST_ERROR" == "false" ]; then
    GENERATED_PATHS=(node_modules dist .venv .ruff_cache *.egg-info)
    for pattern in "${GENERATED_PATHS[@]}"; do
      for path in $pattern; do
        [ "$path" == "$pattern" ] && [ ! -e "$path" ] && continue
        [ ! -e "$path" ] && continue
        [ "$path" == "$STATE_DIR" ] && continue

        IS_PRE_EXISTING=false
        if [ -f "$STATE_DIR/snapshot_pre_existing_items" ]; then
          if grep -Fqx "$path" "$STATE_DIR/snapshot_pre_existing_items" 2>/dev/null; then
            IS_PRE_EXISTING=true
          fi
        fi

        if [ "$IS_PRE_EXISTING" == "false" ] && validate_workspace_path "$path"; then
          rm -rf "$path"
        fi
      done
    done
  else
    echo "Notice: Snapshot is missing, incomplete, or state is invalid. Preserving generated paths to prevent data loss." >&2
  fi

  # 3. Restore backed up root items recorded in backed_up_files
  if [ "$HAD_MANIFEST_ERROR" == "false" ] && [ -f "$STATE_DIR/backed_up_files" ]; then
    while IFS='|' read -r orig_item bak_item || [ -n "$orig_item" ]; do
      [ -z "$orig_item" ] && continue

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
      else
        echo "Error: Missing backup destination '$bak_item' for '$orig_item'." >&2
        HAD_RESTORE_FAILURE=true
      fi
    done < "$STATE_DIR/backed_up_files"
  elif [ "$HAD_MANIFEST_ERROR" == "true" ]; then
    HAD_RESTORE_FAILURE=true
  fi

  # 4. Restore stashed __tests__ directory
  if [ "$STASH_INFO_VALID" == "true" ]; then
    STASH_PATH=""
    TESTS_EXISTED=""
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "$line" ] && continue
      if [[ "$line" == stash_tests_path=* ]]; then
        STASH_PATH="${line#stash_tests_path=}"
      elif [[ "$line" == tests_existed_before_setup=* ]]; then
        TESTS_EXISTED="${line#tests_existed_before_setup=}"
      fi
    done < "$STATE_DIR/stash.info"

    if [[ "$TESTS_EXISTED" == "true" ]]; then
      if [ -n "$STASH_PATH" ] && [ -d "$STASH_PATH/__tests__" ]; then
        if [ "${INJECT_FAILURE_RESTORE:-0}" -eq 1 ]; then
          echo "Error: Injected failure restoring stashed __tests__." >&2
          HAD_RESTORE_FAILURE=true
        else
          rm -rf __tests__
          if mv "$STASH_PATH/__tests__" .; then
            rm -rf "$STASH_PATH"
          else
            echo "Error: Failed to restore stashed __tests__ from '$STASH_PATH'. Preserving stash directory for recovery." >&2
            HAD_RESTORE_FAILURE=true
          fi
        fi
      else
        echo "Error: Invalid or missing stashed __tests__ directory at '$STASH_PATH'." >&2
        HAD_RESTORE_FAILURE=true
      fi
    elif [[ "$TESTS_EXISTED" == "false" ]]; then
      rm -rf __tests__
      if [ -n "$STASH_PATH" ] && [ -d "$STASH_PATH" ]; then
        rm -rf "$STASH_PATH"
      fi
    fi
  elif [ "$LIFECYCLE_STAGE" == "setup_started" ] && [ ! -f "$STATE_DIR/stash.info" ]; then
    # Setup failed before stashing __tests__ was reached; __tests__ was untouched
    :
  else
    echo "Error: Invalid or missing stash.info. Preserving __tests__ and state directory." >&2
    HAD_RESTORE_FAILURE=true
  fi

  if [ "$HAD_RESTORE_FAILURE" == "false" ] && [ "$HAD_MANIFEST_ERROR" == "false" ]; then
    rm -rf "$STATE_DIR"
    exit 0
  else
    echo "Warning: Cleanup or restoration encountered errors. Preserving state directory '$STATE_DIR' for recovery." >&2
    exit 1
  fi

else
  echo "Usage: $0 {setup|cleanup} [args...]" >&2
  exit 1
fi
