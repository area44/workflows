#!/usr/bin/env bash
set -euo pipefail

# test-workspace-cleanup.sh: Ownership-aware, crash-safe setup and cleanup for GitHub Actions test matrix runs.
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
  src
  README.md
)

# Helper to check if a root item is allowed for backup/restoration
is_allowed_root_item() {
  local item="${1:-}"
  # Forbid empty or reserved root paths
  if [[ -z "$item" || "$item" == "." || "$item" == ".." || "$item" == *"/"* || "$item" == ".git" || "$item" == ".github" || "$item" == "$STATE_DIR" || "$item" == "pages" || "$item" == "autofix" ]]; then
    return 1
  fi
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

# Helper to validate stash path format without requiring folder existence
validate_stash_path_format() {
  local p="${1:-}"
  local base="${RUNNER_TEMP:-/tmp}"

  if [[ -z "$p" || "$p" != /* || "$p" == *".."* ]]; then
    echo "Error: Refusing to operate on unsafe or non-absolute stash path: '$p'" >&2
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
  local base_real
  base_real=$(cd "$base" 2>/dev/null && pwd -P || true)
  if [[ -z "$base_real" || -z "$parent_real" || "$parent_real" != "$base_real" ]]; then
    echo "Error: Stash path '$p' is outside approved base directory '$base'." >&2
    return 1
  fi

  return 0
}

# Helper to append to journal atomically
log_journal() {
  local entry="${1:-}"
  if [ -d "$STATE_DIR" ]; then
    echo "$entry" >> "$STATE_DIR/journal.log"
  fi
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

  if [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ]; then
    cp -r "$FIXTURE"/* "$TMP_FIX"/ || {
      echo "Error: Failed to copy fixture into temp dir." >&2
      exit 1
    }
  else
    node "$REPO_ROOT/.github/scripts/generate-consumer-project.js" "$TMP_FIX" \
      --action "$ACTION" \
      --runtime "$RUNTIME" \
      --pm "$PM" \
      --type "$TYPE" \
      ${FIXTURE:+--fixture "$FIXTURE"} || {
      echo "Error: Failed to generate dynamic scenario project." >&2
      exit 1
    }
  fi

  # Guard reserved local action directories and unallowed fixture root items that collide with existing workspace items
  for reserved in pages autofix; do
    if [ -e "$TMP_FIX/$reserved" ]; then
      echo "Error: Fixture contains reserved local action directory '${reserved}'. Aborting setup to protect action source." >&2
      exit 1
    fi
  done

  # Validate fixture root item collision against is_allowed_root_item BEFORE mutating workspace
  if ls -1A "$TMP_FIX" >/dev/null 2>&1; then
    for item in "$TMP_FIX"/*; do
      [ ! -e "$item" ] && continue
      base_item=$(basename "$item")
      if [ -e "$base_item" ]; then
        if ! is_allowed_root_item "$base_item"; then
          echo "Error: Fixture item '$base_item' collides with existing workspace item but is not in ROOT_ITEMS allowlist. Aborting setup to prevent unsafe backup." >&2
          exit 1
        fi
      fi
    done
  fi

  mkdir -p "$STATE_DIR" || {
    echo "Error: Failed to create state directory '$STATE_DIR'." >&2
    exit 1
  }

  touch "$STATE_DIR/journal.log"
  echo "SETUP_PHASE=PHASE_INIT" > "$STATE_DIR/phase.status"

  if [ "${INJECT_FAILURE_BEFORE_SNAPSHOT:-0}" -eq 1 ]; then
    echo "Injected failure before snapshot initialization." >&2
    exit 1
  fi

  # 1. Stash __tests__
  echo "SETUP_PHASE=PHASE_STASHING" > "$STATE_DIR/phase.status"

  TMP_TESTS_BASE="${RUNNER_TEMP:-/tmp}"
  mkdir -p "$TMP_TESTS_BASE"
  TMP_TESTS=$(mktemp -d "${TMP_TESTS_BASE}/tests_stash_XXXXXX") || {
    echo "Error: Failed to create safe stash directory." >&2
    exit 1
  }
  echo "stash_tests_path=$TMP_TESTS" > "$STATE_DIR/stash.info"

  log_journal "STASH_PENDING|$TMP_TESTS"

  if [ -d __tests__ ]; then
    echo "tests_existed_before_setup=true" >> "$STATE_DIR/stash.info"
    mv __tests__ "$TMP_TESTS"/ || {
      echo "Error: Failed to stash __tests__ directory." >&2
      exit 1
    }
  else
    echo "tests_existed_before_setup=false" >> "$STATE_DIR/stash.info"
  fi

  log_journal "STASH_DONE|$TMP_TESTS"
  echo "SETUP_PHASE=PHASE_STASHED" > "$STATE_DIR/phase.status"

  if [ "${INJECT_FAILURE_AFTER_STASH:-0}" -eq 1 ]; then
    echo "Injected failure after stashing __tests__." >&2
    exit 1
  fi

  # 2. Snapshot pre-existing items in current working directory
  echo "SETUP_PHASE=PHASE_SNAPSHOTING" > "$STATE_DIR/phase.status"
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
  echo "SETUP_PHASE=PHASE_SNAPSHOTTED" > "$STATE_DIR/phase.status"

  # 3. Initialize backup, installation, and ownership manifests
  echo "SETUP_PHASE=PHASE_BACKING_UP" > "$STATE_DIR/phase.status"
  touch "$STATE_DIR/backed_up_files"
  touch "$STATE_DIR/installed_fixture_files"
  touch "$STATE_DIR/fixture_ownership_manifest"

  if ls -1A "$TMP_FIX" > "$STATE_DIR/fixture_ownership_manifest" 2>/dev/null; then
    :
  else
    touch "$STATE_DIR/fixture_ownership_manifest"
  fi

  for item in "${ROOT_ITEMS[@]}"; do
    if [ -e "$item" ]; then
      bak_item="${item}.test_bak_$$"
      if [ -e "$bak_item" ]; then
        echo "Error: Backup destination '${bak_item}' already exists for '${item}'. Aborting setup to prevent data loss." >&2
        exit 1
      fi
      log_journal "BACKUP_PENDING|${item}|${bak_item}"
      if [ "${INJECT_FAILURE_BEFORE_BACKUP_MOVE:-0}" -eq 1 ]; then
        echo "Injected failure before backup move." >&2
        exit 1
      fi
      mv "$item" "$bak_item" || {
        echo "Error: Failed to back up '${item}'." >&2
        exit 1
      }
      if [ "${INJECT_FAILURE_AFTER_BACKUP_MOVE:-0}" -eq 1 ]; then
        echo "Injected failure after backup move but before recording completion." >&2
        exit 1
      fi
      echo "${item}|${bak_item}" >> "$STATE_DIR/backed_up_files"
      log_journal "BACKUP_DONE|${item}|${bak_item}"
    fi
  done

  echo "SETUP_PHASE=PHASE_BACKED_UP" > "$STATE_DIR/phase.status"

  # 4. Install fixture files safely and record each installation
  echo "SETUP_PHASE=PHASE_INSTALLING" > "$STATE_DIR/phase.status"
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
        log_journal "BACKUP_PENDING|${item}|${bak_item}"
        mv "$item" "$bak_item" || {
          echo "Error: Failed to back up conflicting root item '${item}'." >&2
          rm -f "$STATE_DIR/fixture_items_list"
          exit 1
        }
        echo "${item}|${bak_item}" >> "$STATE_DIR/backed_up_files"
        log_journal "BACKUP_DONE|${item}|${bak_item}"
      fi

      log_journal "INSTALL_PENDING|${item}"
      cp -r "$TMP_FIX/$item" . || {
        echo "Error: Failed to install fixture item '${item}'." >&2
        rm -f "$STATE_DIR/fixture_items_list"
        exit 1
      }
      if [ "${INJECT_FAILURE_AFTER_COPY_FILE:-0}" -eq 1 ]; then
        echo "Injected failure after copying fixture item but before recording installation." >&2
        rm -f "$STATE_DIR/fixture_items_list"
        exit 1
      fi
      echo "$item" >> "$STATE_DIR/installed_fixture_files"
      log_journal "INSTALL_DONE|${item}"
    done < "$STATE_DIR/fixture_items_list"
    rm -f "$STATE_DIR/fixture_items_list"
  fi

  echo "SETUP_PHASE=PHASE_COMPLETE" > "$STATE_DIR/phase.status"
  exit 0

elif [[ "$MODE" == "cleanup" ]]; then
  shopt -s dotglob

  # If state directory does not exist, cleanup cannot establish ownership state. Return 0.
  if [ ! -d "$STATE_DIR" ]; then
    echo "Notice: Workspace state directory '$STATE_DIR' is missing. Skipping cleanup." >&2
    exit 0
  fi

  VALIDATION_FAILED=false

  # Determine and validate setup phase value strictly
  SETUP_PHASE=""
  if [ -f "$STATE_DIR/phase.status" ]; then
    lines_count=$(wc -l < "$STATE_DIR/phase.status" 2>/dev/null || echo 0)
    if [ "$lines_count" -gt 1 ]; then
      echo "Error: Conflicting phase status entries in phase.status. Failing closed." >&2
      VALIDATION_FAILED=true
    else
      SETUP_PHASE=$(grep "^SETUP_PHASE=" "$STATE_DIR/phase.status" 2>/dev/null | cut -d'=' -f2- || true)
    fi
  fi

  VALID_PHASES=("PHASE_INIT" "PHASE_STASHING" "PHASE_STASHED" "PHASE_SNAPSHOTING" "PHASE_SNAPSHOTTED" "PHASE_BACKING_UP" "PHASE_BACKED_UP" "PHASE_INSTALLING" "PHASE_COMPLETE")

  is_valid_phase=false
  for vp in "${VALID_PHASES[@]}"; do
    if [[ "$SETUP_PHASE" == "$vp" ]]; then
      is_valid_phase=true
      break
    fi
  done

  if [[ "$is_valid_phase" != "true" ]]; then
    echo "Error: State directory exists with invalid or unknown SETUP_PHASE '$SETUP_PHASE'. Failing closed." >&2
    VALIDATION_FAILED=true
  fi

  # Mandatory phase metadata check based on phase reached
  if [[ "$SETUP_PHASE" == "PHASE_STASHING" || "$SETUP_PHASE" == "PHASE_STASHED" || "$SETUP_PHASE" == "PHASE_SNAPSHOTING" || "$SETUP_PHASE" == "PHASE_SNAPSHOTTED" || "$SETUP_PHASE" == "PHASE_BACKING_UP" || "$SETUP_PHASE" == "PHASE_BACKED_UP" || "$SETUP_PHASE" == "PHASE_INSTALLING" || "$SETUP_PHASE" == "PHASE_COMPLETE" ]]; then
    if [ ! -f "$STATE_DIR/stash.info" ]; then
      echo "Error: Missing mandatory 'stash.info' for setup phase '$SETUP_PHASE'. Failing closed." >&2
      VALIDATION_FAILED=true
    fi
  fi

  if [[ "$SETUP_PHASE" == "PHASE_SNAPSHOTING" || "$SETUP_PHASE" == "PHASE_SNAPSHOTTED" || "$SETUP_PHASE" == "PHASE_BACKING_UP" || "$SETUP_PHASE" == "PHASE_BACKED_UP" || "$SETUP_PHASE" == "PHASE_INSTALLING" || "$SETUP_PHASE" == "PHASE_COMPLETE" ]]; then
    if [ ! -f "$STATE_DIR/snapshot_pre_existing_items" ]; then
      echo "Error: Missing mandatory 'snapshot_pre_existing_items' for setup phase '$SETUP_PHASE'. Failing closed." >&2
      VALIDATION_FAILED=true
    fi
  fi

  if [[ "$SETUP_PHASE" == "PHASE_SNAPSHOTTED" || "$SETUP_PHASE" == "PHASE_BACKING_UP" || "$SETUP_PHASE" == "PHASE_BACKED_UP" || "$SETUP_PHASE" == "PHASE_INSTALLING" || "$SETUP_PHASE" == "PHASE_COMPLETE" ]]; then
    if [ ! -f "$STATE_DIR/snapshot.status" ]; then
      echo "Error: Missing mandatory 'snapshot.status' for setup phase '$SETUP_PHASE'. Failing closed." >&2
      VALIDATION_FAILED=true
    fi
  fi

  if [[ "$SETUP_PHASE" == "PHASE_BACKING_UP" || "$SETUP_PHASE" == "PHASE_BACKED_UP" || "$SETUP_PHASE" == "PHASE_INSTALLING" || "$SETUP_PHASE" == "PHASE_COMPLETE" ]]; then
    if [ ! -f "$STATE_DIR/backed_up_files" ] || [ ! -f "$STATE_DIR/installed_fixture_files" ] || [ ! -f "$STATE_DIR/fixture_ownership_manifest" ]; then
      echo "Error: Missing mandatory backup or ownership metadata for setup phase '$SETUP_PHASE'. Failing closed." >&2
      VALIDATION_FAILED=true
    fi
  fi

  # --- JOURNAL LOG VALIDATION & RECONCILIATION ---
  declare -A restored_items=()
  declare -A seen_restore_done=()
  declare -A journal_pending_backups=()
  declare -A journal_done_backups=()

  # Get stash info for RESTORE_DONE reconciliation
  STASH_PATH_INFO=""
  TESTS_EXISTED_INFO=""
  if [ -f "$STATE_DIR/stash.info" ]; then
    STASH_PATH_INFO=$(grep "^stash_tests_path=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)
    TESTS_EXISTED_INFO=$(grep "^tests_existed_before_setup=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)
  fi

  if [ -f "$STATE_DIR/journal.log" ]; then
    while IFS= read -r j_line || [ -n "$j_line" ]; do
      [ -z "$j_line" ] && continue

      # Count pipe fields
      pipe_count=$(tr -dc '|' <<< "$j_line" | wc -c | tr -d ' ' || echo 0)

      IFS='|' read -r j_type j_arg1 j_arg2 <<< "$j_line"

      case "$j_type" in
        STASH_PENDING|STASH_DONE)
          if [ "$pipe_count" -ne 1 ] || [ -z "$j_arg1" ] || [ -n "$j_arg2" ]; then
            echo "Error: Malformed '$j_type' entry in journal.log (invalid field count or empty path). Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi
          if ! validate_stash_path_format "$j_arg1"; then
            echo "Error: Unsafe stash path in journal.log '$j_type' record: '$j_arg1'. Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi
          ;;
        INSTALL_PENDING|INSTALL_DONE)
          if [ "$pipe_count" -ne 1 ] || [ -z "$j_arg1" ] || [ -n "$j_arg2" ]; then
            echo "Error: Malformed '$j_type' entry in journal.log (invalid field count or empty path). Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi
          if ! validate_path "$j_arg1" || [[ "$j_arg1" == *"/"* ]]; then
            echo "Error: Unsafe path in journal.log '$j_type' record: '$j_arg1'. Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi
          ;;
        BACKUP_PENDING|BACKUP_DONE|RESTORE_DONE)
          if [ "$pipe_count" -ne 2 ] || [ -z "$j_arg1" ] || [ -z "$j_arg2" ]; then
            echo "Error: Malformed '$j_type' entry in journal.log (invalid field count or empty path). Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi

          if [ -n "${seen_restore_done[$j_arg1]:-}" ] && [[ "$j_type" == "RESTORE_DONE" ]]; then
            echo "Error: Duplicate RESTORE_DONE entry for '$j_arg1' in journal.log. Failing closed." >&2
            VALIDATION_FAILED=true
            break
          fi

          if [[ "$j_arg1" == "__tests__" ]]; then
            if [[ "$j_type" != "RESTORE_DONE" ]]; then
              echo "Error: Unallowed journal entry type '$j_type' for '__tests__'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            if [[ "$TESTS_EXISTED_INFO" == "false" ]]; then
              echo "Error: RESTORE_DONE for '__tests__' recorded when tests_existed_before_setup=false. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            stashed_expected="${STASH_PATH_INFO}/__tests__"
            if [[ "$j_arg2" != "$stashed_expected" ]]; then
              echo "Error: RESTORE_DONE path for '__tests__' ('$j_arg2') does not match stash.info stashed path ('$stashed_expected'). Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            if ! validate_stash_path_format "$STASH_PATH_INFO"; then
              echo "Error: Unsafe stash path format in stash.info for RESTORE_DONE: '$STASH_PATH_INFO'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            # Physical verification: Either stashed __tests__ exists in stash OR restored __tests__ exists in workspace
            if [ ! -d "$j_arg2" ] && [ ! -d "__tests__" ]; then
              echo "Error: RESTORE_DONE recorded for '__tests__', but neither stashed directory nor workspace '__tests__' exists. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
          else
            if ! validate_path "$j_arg1" || [[ "$j_arg1" == *"/"* ]]; then
              echo "Error: Unsafe original path in journal.log '$j_type' record: '$j_arg1'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            if ! validate_path "$j_arg2" || [[ "$j_arg2" == *"/"* ]]; then
              echo "Error: Unsafe backup path in journal.log '$j_type' record: '$j_arg2'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            if ! is_allowed_root_item "$j_arg1"; then
              echo "Error: Unallowed root item in journal.log '$j_type' record: '$j_arg1'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            bak_prefix="${j_arg1}.test_bak_"
            if [[ "$j_arg2" != "$bak_prefix"* ]]; then
              echo "Error: Mismatched backup filename prefix in journal.log '$j_type' record for '$j_arg1': '$j_arg2'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            pid_suffix="${j_arg2#"$bak_prefix"}"
            if [[ -z "$pid_suffix" || "$pid_suffix" =~ [^0-9] ]]; then
              echo "Error: Mismatched backup filename suffix in journal.log '$j_type' record for '$j_arg1': '$j_arg2'. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            # Physical verification for RESTORE_DONE: Either orig_item exists in workspace OR bak_item exists
            if [[ "$j_type" == "RESTORE_DONE" ]]; then
              if [ ! -e "$j_arg1" ] && [ ! -e "$j_arg2" ]; then
                echo "Error: RESTORE_DONE recorded for '$j_arg1', but neither original item nor backup file '$j_arg2' exists. Failing closed." >&2
                VALIDATION_FAILED=true
                break
              fi
            fi
          fi

          if [[ "$j_type" == "RESTORE_DONE" ]]; then
            seen_restore_done["$j_arg1"]="$j_arg2"
            restored_items["$j_arg1"]="$j_arg2"
          elif [[ "$j_type" == "BACKUP_PENDING" ]]; then
            if [ -n "${journal_pending_backups[$j_arg1]:-}" ] && [ "${journal_pending_backups[$j_arg1]}" != "$j_arg2" ]; then
              echo "Error: Conflicting BACKUP_PENDING path for '$j_arg1' in journal.log. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            journal_pending_backups["$j_arg1"]="$j_arg2"
          elif [[ "$j_type" == "BACKUP_DONE" ]]; then
            if [ -n "${journal_done_backups[$j_arg1]:-}" ] && [ "${journal_done_backups[$j_arg1]}" != "$j_arg2" ]; then
              echo "Error: Conflicting BACKUP_DONE path for '$j_arg1' in journal.log. Failing closed." >&2
              VALIDATION_FAILED=true
              break
            fi
            journal_done_backups["$j_arg1"]="$j_arg2"
          fi
          ;;
        *)
          echo "Error: Unknown record type '$j_type' in journal.log. Failing closed." >&2
          VALIDATION_FAILED=true
          break
          ;;
      esac
    done < "$STATE_DIR/journal.log"
  fi

  # --- PHASE 1: ATOMIC VALIDATION PHASE (NO DESTRUCTIVE MUTATIONS) ---

  # 1. Pre-validate fixture ownership manifest and installed_fixture_files
  declare -A valid_fixture_owners=()
  if [ -f "$STATE_DIR/fixture_ownership_manifest" ]; then
    while IFS= read -r owner_item || [ -n "$owner_item" ]; do
      [ -z "$owner_item" ] && continue
      if ! validate_path "$owner_item" || [[ "$owner_item" == *"/"* ]]; then
        echo "Error: Fixture ownership manifest contains invalid item '$owner_item'. Failing closed." >&2
        VALIDATION_FAILED=true
        break
      fi
      valid_fixture_owners["$owner_item"]=1
    done < "$STATE_DIR/fixture_ownership_manifest"
  fi

  valid_installed_fixture_items=()
  if [ -f "$STATE_DIR/installed_fixture_files" ]; then
    while IFS= read -r item || [ -n "$item" ]; do
      [ -z "$item" ] && continue
      if ! validate_path "$item" || [[ "$item" == *"/"* ]]; then
        echo "Error: Installed fixture manifest contains invalid or nested path '$item'. Failing closed." >&2
        VALIDATION_FAILED=true
        break
      fi

      # Ownership check: item MUST be recorded in valid_fixture_owners
      if [ -z "${valid_fixture_owners[$item]:-}" ]; then
        echo "Error: Installed fixture file '$item' is not present in fixture ownership manifest. Failing closed." >&2
        VALIDATION_FAILED=true
        break
      fi

      valid_installed_fixture_items+=("$item")
    done < "$STATE_DIR/installed_fixture_files"
  fi

  # Also add any INSTALL_PENDING items from journal that exist in workspace and match ownership
  if [ -f "$STATE_DIR/journal.log" ]; then
    while IFS='|' read -r j_type j_arg1 j_arg2 || [ -n "$j_type" ]; do
      if [[ "$j_type" == "INSTALL_PENDING" ]] && [ -n "$j_arg1" ]; then
        if validate_path "$j_arg1" && [[ "$j_arg1" != *"/"* ]] && [ -n "${valid_fixture_owners[$j_arg1]:-}" ] && [ -e "$j_arg1" ]; then
          # Check if not already added
          already_added=false
          for existing_inst in "${valid_installed_fixture_items[@]}"; do
            if [[ "$existing_inst" == "$j_arg1" ]]; then
              already_added=true
              break
            fi
          done
          if [[ "$already_added" == "false" ]]; then
            valid_installed_fixture_items+=("$j_arg1")
          fi
        fi
      fi
    done < "$STATE_DIR/journal.log"
  fi

  # 2. Pre-validate snapshot status
  SNAPSHOT_COMPLETE=false
  if [ -f "$STATE_DIR/snapshot.status" ]; then
    if grep -Fqx "SNAPSHOT_STATUS=complete" "$STATE_DIR/snapshot.status" 2>/dev/null; then
      SNAPSHOT_COMPLETE=true
    fi
  fi

  # 3. Pre-validate backed_up_files manifest and journal entries
  valid_orig_items=()
  valid_bak_items=()
  declare -A seen_orig_items=()
  declare -A seen_bak_items=()

  if [ -f "$STATE_DIR/backed_up_files" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "$line" ] && continue

      # Must contain exactly one pipe delimiter
      if [[ "$line" != *"|"* ]] || [[ "$line" == *"|"*'|'* ]]; then
        echo "Error: Malformed record in backed_up_files (invalid delimiter): '$line'." >&2
        VALIDATION_FAILED=true
        break
      fi

      IFS='|' read -r orig_item bak_item <<< "$line"

      if [ -z "$orig_item" ] || [ -z "$bak_item" ]; then
        echo "Error: Missing item in backup mapping: '$line'." >&2
        VALIDATION_FAILED=true
        break
      fi

      if ! validate_path "$orig_item" || [[ "$orig_item" == *"/"* ]]; then
        echo "Error: Unsafe original path in backup mapping: '$orig_item'." >&2
        VALIDATION_FAILED=true
        break
      fi

      if ! validate_path "$bak_item" || [[ "$bak_item" == *"/"* ]]; then
        echo "Error: Unsafe backup path in backup mapping: '$bak_item'." >&2
        VALIDATION_FAILED=true
        break
      fi

      if ! is_allowed_root_item "$orig_item"; then
        echo "Error: Unallowed root item in backed_up_files: '$orig_item'." >&2
        VALIDATION_FAILED=true
        break
      fi

      # Backup path literal suffix check: must equal `${orig_item}.test_bak_<digits>`
      bak_prefix="${orig_item}.test_bak_"
      if [[ "$bak_item" != "$bak_prefix"* ]]; then
        echo "Error: Mismatched backup filename prefix for '$orig_item': '$bak_item'." >&2
        VALIDATION_FAILED=true
        break
      fi

      pid_suffix="${bak_item#"$bak_prefix"}"
      if [[ -z "$pid_suffix" || "$pid_suffix" =~ [^0-9] ]]; then
        echo "Error: Mismatched backup filename suffix for '$orig_item': '$bak_item'." >&2
        VALIDATION_FAILED=true
        break
      fi

      if [ -n "${seen_orig_items[$orig_item]:-}" ]; then
        echo "Error: Duplicate original item entry for '$orig_item' in backed_up_files." >&2
        VALIDATION_FAILED=true
        break
      fi

      if [ -n "${seen_bak_items[$bak_item]:-}" ]; then
        echo "Error: Duplicate backup item entry for '$bak_item' in backed_up_files." >&2
        VALIDATION_FAILED=true
        break
      fi

      # Exact (orig_item, bak_item) pair validation against RESTORE_DONE
      if [ -n "${restored_items[$orig_item]:-}" ]; then
        if [ "${restored_items[$orig_item]}" != "$bak_item" ]; then
          echo "Error: RESTORE_DONE backup path '${restored_items[$orig_item]}' for '$orig_item' conflicts with manifest mapping '$bak_item'. Failing closed." >&2
          VALIDATION_FAILED=true
          break
        fi
        if [ ! -e "$bak_item" ] && [ ! -e "$orig_item" ]; then
          echo "Error: RESTORE_DONE recorded for '$orig_item' ($bak_item), but neither backup file nor original path exists. Failing closed." >&2
          VALIDATION_FAILED=true
          break
        fi
      else
        # Verify presence of backup file if restoration was not already completed
        if [ ! -e "$bak_item" ]; then
          echo "Error: Expected backup file '$bak_item' for '$orig_item' is missing. Failing closed." >&2
          VALIDATION_FAILED=true
          break
        fi
      fi

      seen_orig_items["$orig_item"]=1
      seen_bak_items["$bak_item"]=1
      valid_orig_items+=("$orig_item")
      valid_bak_items+=("$bak_item")
    done < "$STATE_DIR/backed_up_files"
  fi

  # Check journal for BACKUP_PENDING/BACKUP_DONE records that might not be in backed_up_files (interrupted setup)
  if [ -f "$STATE_DIR/journal.log" ]; then
    while IFS='|' read -r j_type j_orig j_bak || [ -n "$j_type" ]; do
      if [[ "$j_type" == "BACKUP_PENDING" || "$j_type" == "BACKUP_DONE" ]]; then
        if [ -n "$j_orig" ] && [ -n "$j_bak" ] && [ -z "${seen_orig_items[$j_orig]:-}" ]; then
          if validate_path "$j_orig" && validate_path "$j_bak" && is_allowed_root_item "$j_orig"; then
            if [ -n "${restored_items[$j_orig]:-}" ]; then
              if [ "${restored_items[$j_orig]}" != "$j_bak" ]; then
                echo "Error: RESTORE_DONE backup path '${restored_items[$j_orig]}' for '$j_orig' conflicts with journal backup record '$j_bak'. Failing closed." >&2
                VALIDATION_FAILED=true
                break
              fi
              if [ ! -e "$j_bak" ] && [ ! -e "$j_orig" ]; then
                echo "Error: RESTORE_DONE recorded for '$j_orig' ($j_bak), but neither backup file nor original path exists. Failing closed." >&2
                VALIDATION_FAILED=true
                break
              fi
            else
              if [ -e "$j_bak" ]; then
                seen_orig_items["$j_orig"]=1
                seen_bak_items["$j_bak"]=1
                valid_orig_items+=("$j_orig")
                valid_bak_items+=("$j_bak")
              elif [ ! -e "$j_orig" ]; then
                echo "Error: Journal records pending backup for '$j_orig' to '$j_bak', but backup file is missing and original item is gone. Failing closed." >&2
                VALIDATION_FAILED=true
                break
              fi
            fi
          fi
        fi
      fi
    done < "$STATE_DIR/journal.log"
  fi

  # 4. Pre-validate stash info
  STASH_PATH=""
  TESTS_EXISTED=""
  if [ -f "$STATE_DIR/stash.info" ]; then
    STASH_PATH=$(grep "^stash_tests_path=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)
    TESTS_EXISTED=$(grep "^tests_existed_before_setup=" "$STATE_DIR/stash.info" 2>/dev/null | cut -d'=' -f2- || true)

    # Reconcile stash validation with previous restoration pass or missing stash on disk
    if [[ "$TESTS_EXISTED" == "true" ]]; then
      # If RESTORE_DONE for __tests__ was logged, or if __tests__ exists in workspace and STASH_PATH is already gone
      if [ -n "${restored_items["__tests__"]:-}" ] || { [ ! -d "$STASH_PATH" ] && [ -d "__tests__" ]; }; then
        # Restoration already completed previously or stash already removed safely
        :
      else
        if [ -z "$STASH_PATH" ] || ! validate_stash_path "$STASH_PATH"; then
          echo "Error: Invalid or unverified stashed __tests__ directory path at '$STASH_PATH'." >&2
          VALIDATION_FAILED=true
        else
          stashed_tests="${STASH_PATH}/__tests__"
          # In PHASE_STASHING, __tests__ could either be in workspace or already moved into stash
          if [[ "$SETUP_PHASE" == "PHASE_STASHING" ]]; then
            if [ ! -d "$stashed_tests" ] && [ ! -d "__tests__" ]; then
              echo "Error: Neither stashed __tests__ nor workspace __tests__ exist during PHASE_STASHING." >&2
              VALIDATION_FAILED=true
            fi
          else
            if { [ ! -d "$stashed_tests" ] || [ -L "$stashed_tests" ]; } && [ ! -d "__tests__" ]; then
              echo "Error: Stashed __tests__ directory at '$stashed_tests' is missing, not a directory, or is a symbolic link." >&2
              VALIDATION_FAILED=true
            fi
          fi
        fi
      fi
    elif [[ "$TESTS_EXISTED" == "false" ]]; then
      if [ -n "$STASH_PATH" ] && [ -d "$STASH_PATH" ] && ! validate_stash_path "$STASH_PATH"; then
        echo "Error: Invalid stash path at '$STASH_PATH'." >&2
        VALIDATION_FAILED=true
      fi
    else
      echo "Error: Invalid or missing tests_existed_before_setup state in stash.info: '$TESTS_EXISTED'." >&2
      VALIDATION_FAILED=true
    fi
  fi

  # --- PHASE 2: DESTRUCTIVE EXECUTION PHASE (ONLY RUN IF ALL VALIDATIONS PASSED) ---

  if [ "$VALIDATION_FAILED" == "true" ]; then
    echo "Error: Aborting cleanup execution due to manifest validation failures. Preserving workspace and recovery state." >&2
    exit 1
  fi

  HAD_RESTORE_FAILURE=false

  # Step 1: Remove installed fixture files
  for item in "${valid_installed_fixture_items[@]}"; do
    if [ -n "$item" ] && validate_path "$item"; then
      rm -rf "$item"
    fi
  done

  # Step 2: Clean up workflow-generated paths/artifacts ONLY if snapshot status is 'complete'
  if [ "$SNAPSHOT_COMPLETE" == "true" ]; then
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
    echo "Notice: Snapshot is missing or incomplete. Preserving generated paths to prevent data loss." >&2
  fi

  # Step 3: Restore backed up root items
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
      if mv "$bak_item" "$orig_item"; then
        log_journal "RESTORE_DONE|${orig_item}|${bak_item}"
      else
        echo "Error: Failed to restore backup '$bak_item' to '$orig_item'. Preserving backup file for recovery." >&2
        HAD_RESTORE_FAILURE=true
      fi
    fi
  done

  # Step 4: Restore stashed __tests__ directory
  if [ -n "$STASH_PATH" ]; then
    if [[ "$TESTS_EXISTED" == "true" ]]; then
      stashed_tests="${STASH_PATH}/__tests__"
      if [ "${INJECT_FAILURE_RESTORE:-0}" -eq 1 ]; then
        echo "Error: Injected failure restoring stashed __tests__." >&2
        HAD_RESTORE_FAILURE=true
      else
        if [ -d "$stashed_tests" ]; then
          rm -rf __tests__
          if mv "$stashed_tests" .; then
            log_journal "RESTORE_DONE|__tests__|${stashed_tests}"
            if [ "${INJECT_FAILURE_AFTER_MV_STASH:-0}" -eq 1 ]; then
              echo "Error: Injected failure after moving stashed __tests__ into workspace." >&2
              HAD_RESTORE_FAILURE=true
            else
              rm -rf "$STASH_PATH"
            fi
          else
            echo "Error: Failed to restore stashed __tests__ from '$stashed_tests'. Preserving stash directory for recovery." >&2
            HAD_RESTORE_FAILURE=true
          fi
        elif [ -d __tests__ ]; then
          echo "Notice: __tests__ directory already in workspace." >&2
          if [ -d "$STASH_PATH" ]; then
            rm -rf "$STASH_PATH"
          fi
        fi
      fi
    elif [[ "$TESTS_EXISTED" == "false" ]]; then
      rm -rf __tests__
      if [ -d "$STASH_PATH" ]; then
        rm -rf "$STASH_PATH"
      fi
    fi
  fi

  # Only remove STATE_DIR if all restorations succeeded
  if [ "$HAD_RESTORE_FAILURE" == "false" ]; then
    rm -rf "$STATE_DIR"
    exit 0
  else
    echo "Error: Restoration encountered errors. Preserving state directory '$STATE_DIR' for recovery." >&2
    exit 1
  fi

else
  echo "Usage: $0 {setup|cleanup} [args...]" >&2
  exit 1
fi
