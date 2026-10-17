/**
 * Sanitizes command strings for logging to prevent accidental credential/token exposure.
 */
export function sanitizeCommandString(cmdStr: string): string {
  return (
    cmdStr
      // Mask URLs containing authentication credentials (e.g. https://user:pass@host, http://token@host)
      .replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]+)?@/gi, "$1***:***@")
      // Mask Bearer credentials (e.g. Bearer secret, Authorization: Bearer "secret with spaces")
      .replace(/\b(Bearer\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1***")
      // Mask sensitive environment variable assignments (e.g. NPM_TOKEN=xyz, GITHUB_TOKEN="my token")
      .replace(
        /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|AUTH|KEY|PAT)[A-Za-z0-9_]*=)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
        "$1***",
      )
      // Mask sensitive CLI flag values (e.g. --token=secret, --secret "my secret", -t secret)
      .replace(
        /((?:^|\s))(--(?:token|auth|password|pass|secret|key|api-key|access-token|pat)|-[tSpP])(=|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
        "$1$2$3***",
      )
      // Mask common token formats (GitHub PATs, npm tokens, Slack tokens, GitLab PATs)
      .replace(
        /(ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{60,}|npm_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9_-]{20,}|glpat-[A-Za-z0-9_-]{20,})/g,
        "***",
      )
  );
}

function sanitizeErrorCause(err: Error, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(err)) {
    return { name: err.name, message: "[Circular]" };
  }
  seen.add(err);

  const result: Record<string, unknown> = {
    name: err.name,
    message: sanitizeCommandString(err.message),
  };

  if ("cause" in err && (err as { cause?: unknown }).cause !== undefined) {
    result.cause = sanitizeCause((err as { cause?: unknown }).cause, seen);
  }

  for (const [key, val] of Object.entries(err)) {
    if (key !== "name" && key !== "message" && key !== "cause") {
      if (typeof val === "string") {
        result[key] = sanitizeCommandString(val);
      } else if (val instanceof Error) {
        result[key] = sanitizeErrorCause(val, seen);
      } else if (typeof val === "object" && val !== null) {
        result[key] = sanitizeCause(val, seen);
      } else {
        result[key] = val;
      }
    }
  }

  return result;
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
        sanitizedObj[key] = sanitizeErrorCause(val, seen);
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
    return sanitizeErrorCause(cause, seen);
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
