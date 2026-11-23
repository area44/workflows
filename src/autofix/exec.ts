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
 * Formats a command and its arguments into a readable display string for logs and error
 * messages. This is a human-readable representation, NOT a guaranteed copy-pasteable shell
 * command: it quotes arguments so the boundaries are unambiguous, but does not fully escape
 * every shell metacharacter. The actual process is always invoked via `exec.exec` with the
 * original, unmodified argument array — this function never mutates or shells out.
 *
 * - Preserves argument order.
 * - Leaves simple tokens (no whitespace, quotes, or shell-sensitive characters) unquoted.
 * - Single-quotes any other token, escaping embedded single quotes as `'\''`.
 * - Never mutates the arguments passed to the process.
 */
export function formatCommand(executable: string, args: readonly string[]): string {
  const parts = [executable, ...args];
  return parts.map(formatToken).join(" ").trim();
}

// Tokens matching this set are safe to display without quoting.
const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;

function formatToken(token: string): string {
  if (token.length === 0) return "''";
  if (SAFE_TOKEN.test(token)) return token;
  // Single-quote and escape any embedded single quotes for an unambiguous display.
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/**
 * Logs a command with the shared `Executing:` prefix immediately before it runs.
 * Call this only after executable resolution has succeeded.
 */
function logExecuting(executable: string, args: readonly string[]): void {
  core.info(`Executing: ${formatCommand(executable, args)}`);
}

/**
 * Resolves a command's executable before logging. Implementations return the executable to
 * actually invoke (which may be an absolute resolved path) or throw when the executable is
 * unavailable. Because resolution runs before `logExecuting`, a failed resolution never emits
 * an `Executing:` line.
 */
export type ExecutableResolver = () => Promise<string> | string;

/**
 * Runs a command after logging it, returning the exit code.
 *
 * Resolution is mandatory: `resolve` runs first, and only on success is the `Executing:` line
 * emitted and the process invoked. If `resolve` throws, the error propagates and nothing is
 * logged — so an unavailable executable never produces a misleading `Executing:` log.
 *
 * The logged command uses `displayExecutable` (the logical tool name) so logs stay readable,
 * while the process is invoked via the resolved executable (which may be an absolute path).
 *
 * Callers are responsible for handling non-zero exit codes.
 */
export async function runLoggedCommand(
  displayExecutable: string,
  args: readonly string[],
  cwd: string,
  resolve: ExecutableResolver,
  options?: { env?: Record<string, string> },
): Promise<number> {
  const resolvedExecutable = await resolve();
  logExecuting(displayExecutable, args);
  return exec.exec(resolvedExecutable, [...args], {
    cwd,
    env: options?.env,
    ignoreReturnCode: true,
  });
}
