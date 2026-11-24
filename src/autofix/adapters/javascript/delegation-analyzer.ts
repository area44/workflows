import { parseCommandInvocationsDetailed, extractShellWrapperScript } from "./shell-parser";

function matchesPmDelegation(cmdTokens: string[], targetScriptName: string): boolean {
  if (cmdTokens.length === 0) return false;
  const [first, second, third] = cmdTokens;

  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "run" &&
    third === targetScriptName
  ) {
    return true;
  }

  if ((first === "pnpm" || first === "bun" || first === "yarn") && second === targetScriptName) {
    return true;
  }

  return false;
}

export function extractDelegatedTarget(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;
  const [first, second, third] = tokens;
  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "run" &&
    third
  ) {
    return third;
  }
  if (
    (first === "pnpm" || first === "bun" || first === "yarn") &&
    second &&
    !second.startsWith("-")
  ) {
    return second;
  }
  return undefined;
}

/**
 * Recursively checks whether a script body or script reference delegates to a target script,
 * safely handling arbitrary depth, shell wrappers (`sh -c`, `bash -c`), and circular dependencies.
 */
export function delegatesToScript(
  scriptBodyOrName: string,
  targetScriptName: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  if (!scriptBodyOrName || !targetScriptName) return false;

  const scriptBody =
    scripts[scriptBodyOrName] !== undefined ? scripts[scriptBodyOrName] : scriptBodyOrName;

  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(scriptBody);
  if (hasSyntaxError) {
    return false;
  }

  for (const tokens of invocations) {
    if (matchesPmDelegation(tokens, targetScriptName)) {
      return true;
    }

    const delegated = extractDelegatedTarget(tokens);
    if (delegated) {
      if (delegated === targetScriptName) return true;
      if (!activePath.has(delegated) && scripts[delegated] !== undefined) {
        activePath.add(delegated);
        try {
          if (delegatesToScript(scripts[delegated], targetScriptName, scripts, activePath)) {
            return true;
          }
        } finally {
          activePath.delete(delegated);
        }
      }
    }

    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      if (delegatesToScript(wrappedScript, targetScriptName, scripts, activePath)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recognizes actual supported package-manager script invocation commands:
 * e.g. `npm run format:write`, `pnpm run format`, `bun run lint:fix`, `yarn run lint:fix`, `pnpm format`, `bun format`,
 * including quoted script arguments (e.g. `npm run "format:write"`) and environment variable assignments.
 * Supports recursive inspection when scripts are provided.
 */
export function doesFixScriptDelegateTo(
  fixScriptBody: string,
  targetScriptName: string,
  scripts: Record<string, string> = {},
): boolean {
  return delegatesToScript(fixScriptBody, targetScriptName, scripts);
}
