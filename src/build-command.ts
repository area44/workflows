import * as core from "@actions/core";
import * as exec from "@actions/exec";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkflowError } from "./errors.js";
import { isExecutableAvailable } from "./process-utils.js";
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

function wrapBuildError(
  err: unknown,
  stage: "build-command-resolution" | "build-command-parsing" | "build-command-execution",
  code: "INVALID_INPUT" | "COMMAND_EXECUTION_FAILURE",
  commandToParse?: string,
): WorkflowError {
  if (err instanceof WorkflowError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const sanitizedMsg = sanitizeCommandString(msg);

  if (stage === "build-command-parsing" && commandToParse) {
    const cleanCmd = sanitizeCommandString(commandToParse);
    return new WorkflowError(code, `Failed to parse build command "${cleanCmd}": ${sanitizedMsg}`, {
      stage,
      command: cleanCmd,
    });
  }

  if (stage === "build-command-execution" && commandToParse) {
    const cleanCmd = sanitizeCommandString(commandToParse);
    return new WorkflowError(
      code,
      `Failed to execute build command "${cleanCmd}": ${sanitizedMsg}`,
      { stage, command: cleanCmd },
    );
  }

  return new WorkflowError(code, `Failed to resolve build command: ${sanitizedMsg}`, { stage });
}

function safelyResolveBuildCommand(
  customCommand?: string,
  defaultCommand?: string,
  pm?: string,
): { commandToParse?: string; error?: WorkflowError } {
  try {
    return { commandToParse: resolveBuildCommandToParse(customCommand, defaultCommand, pm) };
  } catch (err) {
    return { error: wrapBuildError(err, "build-command-resolution", "INVALID_INPUT") };
  }
}

function safelyParseBuildCommand(commandToParse: string): {
  parsed?: ParsedCommand;
  error?: WorkflowError;
} {
  try {
    return { parsed: parseCommand(commandToParse) };
  } catch (err) {
    return { error: wrapBuildError(err, "build-command-parsing", "INVALID_INPUT", commandToParse) };
  }
}

async function safelyExecuteBuildCommand(
  parsed: ParsedCommand,
  commandToParse: string,
): Promise<{ exitCode: number; error?: WorkflowError }> {
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
      return { exitCode, error: err };
    }
    return { exitCode: 0 };
  } catch (err) {
    const execErr = wrapBuildError(
      err,
      "build-command-execution",
      "COMMAND_EXECUTION_FAILURE",
      commandToParse,
    );
    return { exitCode: 1, error: execErr };
  }
}

export function validateBuildOutput(
  outputPath: string = process.env.BUILD_PATH || "dist",
  cwd: string = process.cwd(),
): void {
  const targetPath = outputPath || "dist";
  const targetDir = path.resolve(cwd, targetPath);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Configured build output directory '${targetPath}' does not exist.`,
      { stage: "build-output-validation", path: targetPath },
    );
  }
  const files = fs.readdirSync(targetDir);
  if (files.length === 0) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Configured build output directory '${targetPath}' is empty.`,
      { stage: "build-output-validation", path: targetPath },
    );
  }
}

export async function runBuildCommand(options?: RunBuildCommandOptions): Promise<number> {
  const exitOnFailure = options?.exitOnFailure ?? true;
  const pm = process.env.PACKAGE_MANAGER || "npm";

  const resolved = safelyResolveBuildCommand(
    process.env.BUILD_COMMAND,
    process.env.DEFAULT_BUILD_COMMAND,
    pm,
  );
  if (resolved.error) {
    core.setFailed(resolved.error);
    if (exitOnFailure) process.exit(1);
    return 1;
  }
  const commandToParse = resolved.commandToParse!;

  core.info(`Preparing build command: "${sanitizeCommandString(commandToParse)}"`);

  const parsedResult = safelyParseBuildCommand(commandToParse);
  if (parsedResult.error) {
    core.setFailed(parsedResult.error);
    if (exitOnFailure) process.exit(1);
    return 1;
  }
  const parsed = parsedResult.parsed!;

  const sanitizedArgs = parsed.args.map((a) => (a.includes(" ") ? `"${a}"` : a));
  const sanitizedDisplay = `${parsed.command} ${sanitizedArgs.join(" ")}`.trim();
  core.info(`Executing build command: ${sanitizeCommandString(sanitizedDisplay)}`);

  const execResult = await safelyExecuteBuildCommand(parsed, commandToParse);
  if (execResult.error) {
    core.setFailed(execResult.error);
    if (exitOnFailure) process.exit(execResult.exitCode);
  }
  return execResult.exitCode;
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
  if (process.argv.includes("--validate-only")) {
    try {
      validateBuildOutput();
      core.info("Build output directory validation succeeded.");
    } catch (err) {
      if (err instanceof WorkflowError) {
        core.setFailed(err);
      } else {
        core.setFailed(String(err));
      }
      process.exit(1);
    }
  } else {
    runBuildCommand().catch((err) => {
      core.setFailed(`Unhandled error during build command execution: ${err}`);
      process.exit(1);
    });
  }
}
