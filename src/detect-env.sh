#!/usr/bin/env bash
set -e

RUNTIME_INPUT="${INPUT_RUNTIME:-$1}"

SPECIFIED_RUNTIME=""
NODE_VER_INPUT=""
BUN_VER_INPUT=""
HAS_BUN=false

if [ -n "$RUNTIME_INPUT" ]; then
  TOKENS=$(echo "$RUNTIME_INPUT" | tr ',' ' ')
  for token in $TOKENS; do
    token_lc=$(echo "$token" | tr '[:upper:]' '[:lower:]')
    if [ "$token_lc" = "both" ]; then
      HAS_BUN=true
    elif [[ "$token_lc" == node* ]]; then
      [ -z "$SPECIFIED_RUNTIME" ] && SPECIFIED_RUNTIME="node"
      if [[ "$token_lc" == *@* ]]; then
        NODE_VER_INPUT="${token_lc#*@}"
      fi
    elif [[ "$token_lc" == bun* ]]; then
      HAS_BUN=true
      [ -z "$SPECIFIED_RUNTIME" ] && SPECIFIED_RUNTIME="bun"
      if [[ "$token_lc" == *@* ]]; then
        BUN_VER_INPUT="${token_lc#*@}"
      fi
    fi
  done
fi

if [ "$HAS_BUN" = true ] && [ -z "$BUN_VER_INPUT" ]; then
  BUN_VER_INPUT="latest"
fi

get_dev_engine_runtime() {
  local target="$1"
  if [ -f "package.json" ]; then
    jq -r --arg t "$target" '
      if .devEngines then
        if .devEngines.runtime then
          (if .devEngines.runtime | type == "array" then .devEngines.runtime else [.devEngines.runtime] end) |
          map(
            if type == "string" and (startswith($t)) then
              if contains("@") then split("@")[1] else "latest" end
            elif type == "object" and .name == $t then
              .version // "latest"
            else
              empty
            end
          ) | first // empty
        elif .devEngines[$t] then
          if .devEngines[$t] | type == "string" then .devEngines[$t] else .devEngines[$t].version // "latest" end
        else
          empty
        end
      else
        empty
      end
    ' package.json 2>/dev/null || true
  fi
}

PM_NAME=""
PM_VERSION=""

if [ -f "package.json" ]; then
  RAW_PM=$(jq -r '.packageManager // empty' package.json 2>/dev/null || true)
  if [ -n "$RAW_PM" ]; then
    PM_NAME="${RAW_PM%%@*}"
    PM_VERSION="${RAW_PM#*@}"
    [ "$PM_NAME" = "$PM_VERSION" ] && PM_VERSION="latest"
  fi

  if [ -z "$PM_NAME" ]; then
    DEV_PM=$(jq -r '
      if .devEngines then
        if .devEngines.packageManager then
          local pm;
          pm = (if .devEngines.packageManager | type == "array" then .devEngines.packageManager[0] else .devEngines.packageManager end);
          if pm | type == "string" then pm else (pm.name + "@" + (pm.version // "latest")) end
        elif .devEngines.pnpm then
          "pnpm@" + (if .devEngines.pnpm | type == "string" then .devEngines.pnpm else .devEngines.pnpm.version // "latest" end)
        elif .devEngines.npm then
          "npm@" + (if .devEngines.npm | type == "string" then .devEngines.npm else .devEngines.npm.version // "latest" end)
        elif .devEngines.bun then
          "bun@" + (if .devEngines.bun | type == "string" then .devEngines.bun else .devEngines.bun.version // "latest" end)
        else empty end
      else empty end
    ' package.json 2>/dev/null || true)
    if [ -n "$DEV_PM" ]; then
      PM_NAME="${DEV_PM%%@*}"
      PM_VERSION="${DEV_PM#*@}"
      [ "$PM_NAME" = "$PM_VERSION" ] && PM_VERSION="latest"
    fi
  fi
fi

if [ -z "$PM_NAME" ]; then
  if [ -f "pnpm-lock.yaml" ]; then
    PM_NAME="pnpm"
    PM_VERSION="latest"
  elif [ -f "package-lock.json" ]; then
    PM_NAME="npm"
    PM_VERSION="latest"
  elif [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
    PM_NAME="bun"
    PM_VERSION="latest"
  else
    PM_NAME="npm"
    PM_VERSION="latest"
  fi
fi

DETECTED_BUN_VER=""
if [ -f ".bun-version" ]; then
  DETECTED_BUN_VER=$(tr -d '[:space:]' < .bun-version)
elif [ "$PM_NAME" = "bun" ] && [ -n "$PM_VERSION" ] && [ "$PM_VERSION" != "latest" ]; then
  DETECTED_BUN_VER="$PM_VERSION"
else
  DEV_BUN=$(get_dev_engine_runtime "bun")
  if [ -n "$DEV_BUN" ]; then
    DETECTED_BUN_VER="$DEV_BUN"
  elif [ "$PM_NAME" = "bun" ] || [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
    DETECTED_BUN_VER="latest"
  fi
fi

RUNTIME=""
if [ -n "$SPECIFIED_RUNTIME" ]; then
  RUNTIME="$SPECIFIED_RUNTIME"
elif [ "$PM_NAME" = "bun" ]; then
  RUNTIME="bun"
else
  RUNTIME="node"
fi

DEV_NODE=$(get_dev_engine_runtime "node")

DETECTED_NODE_VER=""
if [ -f ".nvmrc" ]; then
  DETECTED_NODE_VER=$(tr -d '[:space:]' < .nvmrc)
elif [ -f ".node-version" ]; then
  DETECTED_NODE_VER=$(tr -d '[:space:]' < .node-version)
elif [ -n "$DEV_NODE" ]; then
  DETECTED_NODE_VER="$DEV_NODE"
elif [ "$RUNTIME" = "bun" ] || [ "$PM_NAME" = "bun" ]; then
  DETECTED_NODE_VER=""
else
  DETECTED_NODE_VER="lts/*"
fi

FINAL_BUN_VER="${BUN_VER_INPUT:-$DETECTED_BUN_VER}"
if [ -n "$NODE_VER_INPUT" ]; then
  FINAL_NODE_VER="$NODE_VER_INPUT"
elif [ "$RUNTIME" = "bun" ] && [ -z "$NODE_VER_INPUT" ]; then
  if [ -f ".nvmrc" ] || [ -f ".node-version" ] || [ -n "$DEV_NODE" ]; then
    FINAL_NODE_VER="$DETECTED_NODE_VER"
  else
    FINAL_NODE_VER=""
  fi
else
  FINAL_NODE_VER="$DETECTED_NODE_VER"
fi

if [ -n "$GITHUB_OUTPUT" ]; then
  echo "node-version=$FINAL_NODE_VER" >> "$GITHUB_OUTPUT"
  echo "bun-version=$FINAL_BUN_VER" >> "$GITHUB_OUTPUT"
  echo "package-manager=$PM_NAME" >> "$GITHUB_OUTPUT"
  echo "package-manager-version=$PM_VERSION" >> "$GITHUB_OUTPUT"
  echo "runtime=$RUNTIME" >> "$GITHUB_OUTPUT"
fi

echo "node-version=$FINAL_NODE_VER"
echo "bun-version=$FINAL_BUN_VER"
echo "package-manager=$PM_NAME"
echo "package-manager-version=$PM_VERSION"
echo "runtime=$RUNTIME"
