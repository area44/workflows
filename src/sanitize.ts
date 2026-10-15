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

function sanitizeErrorCause(err: Error): { name: string; message: string } {
  return {
    name: err.name,
    message: sanitizeCommandString(err.message),
  };
}

function sanitizeObjectCause(causeObj: object, seen: WeakSet<object>): unknown {
  if (seen.has(causeObj)) {
    return "[Circular]";
  }
  seen.add(causeObj);

  try {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(causeObj as Record<string, unknown>)) {
      if (typeof val === "string") {
        sanitizedObj[key] = sanitizeCommandString(val);
      } else if (val instanceof Error) {
        sanitizedObj[key] = sanitizeErrorCause(val);
      } else if (typeof val === "object" && val !== null) {
        sanitizedObj[key] = sanitizeCause(val, seen);
      } else {
        sanitizedObj[key] = val;
      }
    }
    return sanitizedObj;
  } catch {
    return sanitizeCommandString(JSON.stringify(causeObj));
  }
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
    return sanitizeErrorCause(cause);
  }

  if (typeof cause === "object") {
    return sanitizeObjectCause(cause, seen);
  }

  return sanitizeCommandString(
    typeof cause === "symbol" || typeof cause === "bigint" || typeof cause === "function"
      ? String(cause)
      : JSON.stringify(cause),
  );
}
