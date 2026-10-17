import * as core from "@actions/core";
import * as exec from "@actions/exec";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { WorkflowError } from "./errors.js";
import { isExecutableAvailable } from "./python-env.js";
import { sanitizeCommandString } from "./sanitize.js";

export { sanitizeCommandString };

export interface ParsedCommand {
  command: string;
  args: string[];
}

export function resolveBuildCommandToParse(
  customCommand?: string,
  defaultCommand?: string,
  pm: string = "npm",
  isExecutableCheckAvailable: (cmd: string) => boolean = isExecutableAvailable,
): string {
  const custom = customCommand?.trim();
  if (custom) {
    return custom;
  }

  const defaultCmd = defaultCommand?.trim();
  if (defaultCmd) {
    if (defaultCmd.startsWith("vp ")) {
      const preferredExec = "vp";
      const fallbackExec = "vpr";
      if (!isExecutableCheckAvailable(preferredExec)) {
        if (isExecutableCheckAvailable(fallbackExec)) {
          core.info(
            `Primary Vite+ executable "${preferredExec}" unavailable. Falling back to "${fallbackExec}".`,
          );
          return defaultCmd.replace(/^vp\b/, fallbackExec);
        } else {
          throw new WorkflowError(
            "MISSING_CONFIGURATION",
            `Primary Vite+ executable "${preferredExec}" and fallback executable "${fallbackExec}" are both unavailable in PATH.`,
            { stage: "build-command-resolution", preferredExec, fallbackExec },
          );
        }
      }
    }
    return defaultCmd;
  }

  return `${pm} run build`;
}

interface TokenizerState {
  currentToken: string;
  inDoubleQuote: boolean;
  inSingleQuote: boolean;
  escaped: boolean;
  wasQuoted: boolean;
}

function shouldEscapeBackslash(nextChar: string | undefined, inDoubleQuote: boolean): boolean {
  if (!nextChar) {
    return false;
  }
  if (nextChar === '"' || nextChar === "'" || nextChar === "\\") {
    return true;
  }
  return !inDoubleQuote && /\s/.test(nextChar);
}

function handleBackslash(nextChar: string | undefined, state: TokenizerState): TokenizerState {
  if (shouldEscapeBackslash(nextChar, state.inDoubleQuote)) {
    return { ...state, escaped: true };
  }
  return { ...state, currentToken: state.currentToken + "\\", escaped: false };
}

function handleWhitespace(state: TokenizerState, tokens: string[]): TokenizerState {
  if (state.currentToken.length > 0 || state.wasQuoted) {
    tokens.push(state.currentToken);
  }
  return { ...state, currentToken: "", escaped: false, wasQuoted: false };
}

function handleSingleQuoteState(char: string, state: TokenizerState): TokenizerState {
  if (char === "'") {
    return { ...state, inSingleQuote: false, escaped: false, wasQuoted: true };
  }
  return { ...state, currentToken: state.currentToken + char, escaped: false };
}

function processChar(
  char: string,
  nextChar: string | undefined,
  state: TokenizerState,
  tokens: string[],
): TokenizerState {
  if (state.escaped) {
    return { ...state, currentToken: state.currentToken + char, escaped: false };
  }

  if (state.inSingleQuote) {
    return handleSingleQuoteState(char, state);
  }

  if (char === "\\") {
    return handleBackslash(nextChar, state);
  }

  if (char === '"') {
    return { ...state, inDoubleQuote: !state.inDoubleQuote, escaped: false, wasQuoted: true };
  }

  if (char === "'") {
    return { ...state, inSingleQuote: !state.inSingleQuote, escaped: false, wasQuoted: true };
  }

  if (/\s/.test(char) && !state.inDoubleQuote) {
    return handleWhitespace(state, tokens);
  }

  return { ...state, currentToken: state.currentToken + char, escaped: false };
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
    throw new WorkflowError("INVALID_INPUT", "Unterminated quote in build command string.", {
      stage: "build-command-parsing",
    });
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
    throw new WorkflowError("INVALID_INPUT", "Build command string is empty.", {
      stage: "build-command-parsing",
    });
  }

  const tokens = tokenizeCommand(trimmed);

  if (tokens.length === 0 || !tokens[0]) {
    throw new WorkflowError(
      "INVALID_INPUT",
      "Failed to parse build command: no valid executable found.",
      { stage: "build-command-parsing" },
    );
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
  const customCommand = process.env.BUILD_COMMAND;
  const defaultCommand = process.env.DEFAULT_BUILD_COMMAND;

  const commandToParse = resolveBuildCommandToParse(customCommand, defaultCommand, pm);

  core.info(`Preparing build command: "${sanitizeCommandString(commandToParse)}"`);

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(commandToParse);
  } catch (err) {
    if (err instanceof WorkflowError) {
      core.setFailed(err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      const parseErr = new WorkflowError(
        "INVALID_INPUT",
        `Failed to parse build command "${sanitizeCommandString(commandToParse)}": ${sanitizeCommandString(msg)}`,
        { stage: "build-command-parsing", command: sanitizeCommandString(commandToParse) },
      );
      core.setFailed(parseErr);
    }
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
      const err = new WorkflowError(
        "COMMAND_EXECUTION_FAILURE",
        `Build command failed with exit code ${exitCode}: ${sanitizeCommandString(commandToParse)}`,
        {
          stage: "build-command-execution",
          exitCode,
          command: sanitizeCommandString(commandToParse),
        },
      );
      core.setFailed(err);
      if (exitOnFailure) {
        process.exit(exitCode);
      }
    }
    return exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const execErr = new WorkflowError(
      "COMMAND_EXECUTION_FAILURE",
      `Failed to execute build command "${sanitizeCommandString(commandToParse)}": ${sanitizeCommandString(msg)}`,
      {
        stage: "build-command-execution",
        command: sanitizeCommandString(commandToParse),
      },
    );
    core.setFailed(execErr);
    if (exitOnFailure) {
      process.exit(1);
    }
    return 1;
  }
}

function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  runBuildCommand().catch((err) => {
    core.setFailed(`Unhandled error during build command execution: ${err}`);
    process.exit(1);
  });
}
