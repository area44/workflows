import * as core from "@actions/core";
import * as exec from "@actions/exec";

export interface ExecutionResultLike {
  error?: Error;
}

/**
 * Extracts the `Error` from each result that has one, preserving order.
 * Shared by the orchestrator and providers so failure aggregation stays consistent.
 */
export function collectErrors<T extends ExecutionResultLike>(results: readonly T[]): Error[] {
  return results.filter((r) => r.error).map((r) => r.error as Error);
}

/**
 * Formats a command and its arguments into a readable, copy-pasteable string.
 *
 * - Preserves argument order.
 * - Quotes arguments containing whitespace or quotes so the displayed command is unambiguous.
 * - Never mutates the arguments passed to the process.
 */
export function formatCommand(executable: string, args: readonly string[]): string {
  const parts = [executable, ...args];
  return parts.map(formatToken).join(" ").trim();
}

function formatToken(token: string): string {
  if (token.length === 0) return '""';
  if (/[\s"]/.test(token)) {
    return `"${token.replace(/"/g, '\\"')}"`;
  }
  return token;
}

/**
 * Logs a command with the shared `Executing:` prefix immediately before it runs.
 * Call this only after executable resolution has succeeded.
 */
function logExecuting(executable: string, args: readonly string[]): void {
  core.info(`Executing: ${formatCommand(executable, args)}`);
}

/**
 * Runs a command after logging it, returning the exit code.
 *
 * The logged command uses `displayExecutable` (the logical tool name) so logs stay readable,
 * while the process is invoked via `resolvedExecutable` (which may be a resolved absolute path).
 * When `resolvedExecutable` is omitted, `displayExecutable` is used for both.
 *
 * Callers are responsible for resolving executables first and handling non-zero exit codes.
 */
export async function runLoggedCommand(
  displayExecutable: string,
  args: readonly string[],
  cwd: string,
  options?: { env?: Record<string, string>; resolvedExecutable?: string },
): Promise<number> {
  logExecuting(displayExecutable, args);
  const executable = options?.resolvedExecutable ?? displayExecutable;
  return exec.exec(executable, [...args], {
    cwd,
    env: options?.env,
    ignoreReturnCode: true,
  });
}
