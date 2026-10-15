/**
 * Sanitizes command strings for logging to prevent accidental credential/token exposure.
 */
export function sanitizeCommandString(cmdStr: string): string {
  return (
    cmdStr
      // Mask URLs containing authentication credentials (e.g. https://user:pass@host)
      .replace(/(https?:\/\/)[^:@\s]+:[^@\s]+@/gi, "$1***:***@")
      // Mask sensitive CLI flag values (e.g. --token=secret, --key secret, -t secret)
      .replace(
        /(--(?:token|auth|password|secret|key|api-key|access-token|pat)(?:=|\s+))([^\s]+)/gi,
        "$1***",
      )
      // Mask common token formats (GitHub PATs, npm tokens, Slack tokens)
      .replace(
        /(ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{60,}|npm_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9_-]{20,})/g,
        "***",
      )
  );
}
