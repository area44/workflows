import * as core from "@actions/core";
import * as exec from "@actions/exec";

export interface ParsedCommand {
  command: string;
  args: string[];
}

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

interface TokenizerState {
  currentToken: string;
  inDoubleQuote: boolean;
  inSingleQuote: boolean;
  escaped: boolean;
  wasQuoted: boolean;
}

function processChar(
  char: string,
  nextChar: string | undefined,
  state: TokenizerState,
  tokens: string[],
): TokenizerState {
  const { currentToken, inDoubleQuote, inSingleQuote, escaped, wasQuoted } = state;

  if (escaped) {
    return {
      currentToken: currentToken + char,
      inDoubleQuote,
      inSingleQuote,
      escaped: false,
      wasQuoted,
    };
  }

  // Inside single quotes: all characters including backslashes are literal
  if (inSingleQuote) {
    if (char === "'") {
      return { currentToken, inDoubleQuote, inSingleQuote: false, escaped: false, wasQuoted: true };
    }
    return {
      currentToken: currentToken + char,
      inDoubleQuote,
      inSingleQuote: true,
      escaped: false,
      wasQuoted,
    };
  }

  // Outside single quotes: handle backslash escape contextually
  if (char === "\\") {
    // Escape when followed by quotes, spaces, backslashes, or inside double quotes if followed by quote/backslash
    if (
      inDoubleQuote
        ? nextChar === '"' || nextChar === "\\" || nextChar === "'"
        : nextChar === '"' ||
          nextChar === "'" ||
          nextChar === "\\" ||
          (nextChar && /\s/.test(nextChar))
    ) {
      return { currentToken, inDoubleQuote, inSingleQuote, escaped: true, wasQuoted };
    }
    // Otherwise (e.g. Windows paths like C:\project\dist, C:\Users\test), treat backslash as literal
    return {
      currentToken: currentToken + "\\",
      inDoubleQuote,
      inSingleQuote,
      escaped: false,
      wasQuoted,
    };
  }

  if (char === '"' && !inSingleQuote) {
    return {
      currentToken,
      inDoubleQuote: !inDoubleQuote,
      inSingleQuote,
      escaped: false,
      wasQuoted: true,
    };
  }

  if (char === "'" && !inDoubleQuote) {
    return {
      currentToken,
      inDoubleQuote,
      inSingleQuote: !inSingleQuote,
      escaped: false,
      wasQuoted: true,
    };
  }

  if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
    if (currentToken.length > 0 || wasQuoted) {
      tokens.push(currentToken);
    }
    return { currentToken: "", inDoubleQuote, inSingleQuote, escaped: false, wasQuoted: false };
  }

  return {
    currentToken: currentToken + char,
    inDoubleQuote,
    inSingleQuote,
    escaped: false,
    wasQuoted,
  };
}

function tokenizeCommand(trimmed: string): string[] {
  const tokens: string[] = [];
  let state: TokenizerState = {
    currentToken: "",
    inDoubleQuote: false,
    inSingleQuote: false,
    escaped: false,
    wasQuoted: false,
  };

  for (let i = 0; i < trimmed.length; i++) {
    state = processChar(trimmed[i], trimmed[i + 1], state, tokens);
  }

  if (state.escaped) {
    state.currentToken += "\\";
  }

  if (state.inDoubleQuote || state.inSingleQuote) {
    throw new Error("Unterminated quote in build command string.");
  }

  if (state.currentToken.length > 0 || state.wasQuoted) {
    tokens.push(state.currentToken);
  }

  return tokens;
}

/**
 * Parses a command line string into an executable command and an array of arguments,
 * respecting single/double quotes and escaped characters, without using shell expansion.
 */
export function parseCommand(cmdStr: string): ParsedCommand {
  const trimmed = cmdStr.trim();
  if (!trimmed) {
    throw new Error("Build command string is empty.");
  }

  const tokens = tokenizeCommand(trimmed);

  if (tokens.length === 0 || !tokens[0]) {
    throw new Error("Failed to parse build command: no valid executable found.");
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

export interface RunBuildCommandOptions {
  exitOnFailure?: boolean;
}

export async function runBuildCommand(options?: RunBuildCommandOptions): Promise<number> {
  const exitOnFailure = options?.exitOnFailure ?? true;
  const pm = process.env.PACKAGE_MANAGER || "npm";
  const customCommand = process.env.BUILD_COMMAND?.trim();
  const defaultCommand = process.env.DEFAULT_BUILD_COMMAND?.trim() || `${pm} run build`;

  const commandToParse = customCommand || defaultCommand;

  core.info(`Preparing build command: "${sanitizeCommandString(commandToParse)}"`);

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(commandToParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(
      `Failed to parse build command "${sanitizeCommandString(commandToParse)}": ${msg}`,
    );
    if (exitOnFailure) {
      process.exit(1);
    }
    return 1;
  }

  const sanitizedArgs = parsed.args.map((a) => (a.includes(" ") ? `"${a}"` : a));
  const sanitizedDisplay = `${parsed.command} ${sanitizedArgs.join(" ")}`.trim();

  core.info(`Executing build command: ${sanitizeCommandString(sanitizedDisplay)}`);

  try {
    const exitCode = await exec.exec(parsed.command, parsed.args, {
      ignoreReturnCode: true,
    });

    if (exitCode !== 0) {
      core.setFailed(
        `Build command failed with exit code ${exitCode}: ${sanitizeCommandString(commandToParse)}`,
      );
      if (exitOnFailure) {
        process.exit(exitCode);
      }
    }
    return exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(
      `Failed to execute build command "${sanitizeCommandString(commandToParse)}": ${msg}`,
    );
    if (exitOnFailure) {
      process.exit(1);
    }
    return 1;
  }
}

if (process.env.NODE_ENV !== "test") {
  runBuildCommand().catch((err) => {
    core.setFailed(`Unhandled error during build command execution: ${err}`);
    process.exit(1);
  });
}
