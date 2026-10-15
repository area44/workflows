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

/**
 * Sanitizes nested error causes and context values to prevent credential/token leaks.
 */
export function sanitizeCause(cause: unknown, seen = new WeakSet<object>()): unknown {
  if (cause === null || cause === undefined) {
    return cause;
  }

  if (typeof cause === "string") {
    return sanitizeCommandString(cause);
  }

  if (typeof cause === "number" || typeof cause === "boolean") {
    return cause;
  }

  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: sanitizeCommandString(cause.message),
    };
  }

  if (typeof cause === "object") {
    if (seen.has(cause as object)) {
      return "[Circular]";
    }
    seen.add(cause as object);

    try {
      const sanitizedObj: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(cause as Record<string, unknown>)) {
        if (typeof val === "string") {
          sanitizedObj[key] = sanitizeCommandString(val);
        } else if (val instanceof Error) {
          sanitizedObj[key] = {
            name: val.name,
            message: sanitizeCommandString(val.message),
          };
        } else if (typeof val === "object" && val !== null) {
          sanitizedObj[key] = sanitizeCause(val, seen);
        } else {
          sanitizedObj[key] = val;
        }
      }
      return sanitizedObj;
    } catch {
      return sanitizeCommandString(JSON.stringify(cause));
    }
  }

  return sanitizeCommandString(
    typeof cause === "symbol" || typeof cause === "bigint" || typeof cause === "function"
      ? String(cause)
      : JSON.stringify(cause),
  );
}
