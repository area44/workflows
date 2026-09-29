import * as core from "@actions/core";
import * as exec from "@actions/exec";

export interface ParsedCommand {
  command: string;
  args: string[];
}

interface TokenizerState {
  currentToken: string;
  inDoubleQuote: boolean;
  inSingleQuote: boolean;
  escaped: boolean;
}

function processChar(char: string, state: TokenizerState, tokens: string[]): TokenizerState {
  const { currentToken, inDoubleQuote, inSingleQuote, escaped } = state;

  if (escaped) {
    return { currentToken: currentToken + char, inDoubleQuote, inSingleQuote, escaped: false };
  }

  if (char === "\\") {
    return { currentToken, inDoubleQuote, inSingleQuote, escaped: true };
  }

  if (char === '"' && !inSingleQuote) {
    return { currentToken, inDoubleQuote: !inDoubleQuote, inSingleQuote, escaped: false };
  }

  if (char === "'" && !inDoubleQuote) {
    return { currentToken, inDoubleQuote, inSingleQuote: !inSingleQuote, escaped: false };
  }

  if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
    if (currentToken.length > 0) {
      tokens.push(currentToken);
    }
    return { currentToken: "", inDoubleQuote, inSingleQuote, escaped: false };
  }

  return { currentToken: currentToken + char, inDoubleQuote, inSingleQuote, escaped: false };
}

function tokenizeCommand(trimmed: string): string[] {
  const tokens: string[] = [];
  let state: TokenizerState = {
    currentToken: "",
    inDoubleQuote: false,
    inSingleQuote: false,
    escaped: false,
  };

  for (let i = 0; i < trimmed.length; i++) {
    state = processChar(trimmed[i], state, tokens);
  }

  if (state.escaped) {
    state.currentToken += "\\";
  }

  if (state.inDoubleQuote || state.inSingleQuote) {
    throw new Error("Unterminated quote in build command string.");
  }

  if (state.currentToken.length > 0) {
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

  if (tokens.length === 0) {
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

  core.info(`Preparing build command: "${commandToParse}"`);

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(commandToParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Failed to parse build command "${commandToParse}": ${msg}`);
    if (exitOnFailure) {
      process.exit(1);
    }
    return 1;
  }

  core.info(
    `Executing build command: ${parsed.command} ${parsed.args
      .map((a) => (a.includes(" ") ? `"${a}"` : a))
      .join(" ")}`,
  );

  try {
    const exitCode = await exec.exec(parsed.command, parsed.args, {
      ignoreReturnCode: true,
    });

    if (exitCode !== 0) {
      core.setFailed(`Build command failed with exit code ${exitCode}: ${commandToParse}`);
      if (exitOnFailure) {
        process.exit(exitCode);
      }
    }
    return exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Failed to execute build command "${commandToParse}": ${msg}`);
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
