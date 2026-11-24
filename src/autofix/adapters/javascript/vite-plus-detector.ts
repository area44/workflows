import { extractDelegatedTarget } from "./delegation-analyzer";
import { parseCommandInvocationsDetailed, extractShellWrapperScript } from "./shell-parser";

function isDirectVitePlusInvocation(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  if (tokens[0] === "vp") {
    return true;
  }

  if ((tokens[0] === "npx" || tokens[0] === "bunx") && tokens[1] === "vp") {
    return true;
  }

  if (
    (tokens[0] === "npm" || tokens[0] === "pnpm" || tokens[0] === "yarn") &&
    (tokens[1] === "exec" || tokens[1] === "dlx") &&
    tokens[2] === "vp"
  ) {
    return true;
  }

  return false;
}

function hasVitePlusInShellWrapper(
  tokens: string[],
  scripts: Record<string, string>,
  activePath: Set<string>,
): boolean {
  const wrapped = extractShellWrapperScript(tokens);
  if (wrapped !== undefined) {
    return hasVitePlusCommand(wrapped, scripts, activePath);
  }
  return false;
}

function hasVitePlusInDelegatedScript(
  tokens: string[],
  scripts: Record<string, string>,
  activePath: Set<string>,
): boolean {
  const target = extractDelegatedTarget(tokens);
  if (target && !activePath.has(target) && scripts[target]) {
    activePath.add(target);
    try {
      return hasVitePlusCommand(scripts[target], scripts, activePath);
    } finally {
      activePath.delete(target);
    }
  }
  return false;
}

/**
 * Checks whether an invocation (or nested wrapped invocations) executes the `vp` command.
 * Supports direct invocations, environment wrappers (cross-env), shell wrappers (sh -c, bash -c),
 * package-manager execution wrappers (npx, bunx, pnpm exec, etc.), and script delegations.
 */
export function hasVitePlusCommand(
  scriptBody: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  if (!scriptBody) return false;
  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(scriptBody);
  if (hasSyntaxError) {
    return false;
  }

  for (const tokens of invocations) {
    if (tokens.length === 0) continue;

    if (isDirectVitePlusInvocation(tokens)) {
      return true;
    }

    if (hasVitePlusInShellWrapper(tokens, scripts, activePath)) {
      return true;
    }

    if (hasVitePlusInDelegatedScript(tokens, scripts, activePath)) {
      return true;
    }
  }

  return false;
}

export function hasVitePlusScript(scripts?: Record<string, string>): boolean {
  if (!scripts) return false;
  return Object.values(scripts).some((scriptBody) => {
    return hasVitePlusCommand(scriptBody, scripts);
  });
}
