import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ParsedCommand {
  command: string;
  args: string[];
}

export async function resolveBuildCommandToParse(
  customCommand?: string,
  defaultCommand?: string,
  pm: string = "npm",
  isExecutableCheckAvailable: (cmd: string) => Promise<boolean> = async (cmd) =>
    Boolean(await io.which(cmd, false)),
): Promise<string> {
  const custom = customCommand?.trim();
  if (custom) {
    return custom;
  }

  const defaultCmd = defaultCommand?.trim();
  if (defaultCmd) {
    if (defaultCmd.startsWith("vp ")) {
      const preferredExec = "vp";
      const fallbackExec = "vpr";
      if (!(await isExecutableCheckAvailable(preferredExec))) {
        if (await isExecutableCheckAvailable(fallbackExec)) {
          core.info(
            `Primary Vite+ executable "${preferredExec}" unavailable. Falling back to "${fallbackExec}".`,
          );
          return defaultCmd.replace(/^vp\b/, fallbackExec);
        } else {
          throw new Error(
            `Primary Vite+ executable "${preferredExec}" and fallback executable "${fallbackExec}" are both unavailable in PATH.`,
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

/**
 * Resolves and normalizes the build output path.
 * Trims whitespace and defaults empty or whitespace-only paths to "dist".
 */
export function resolveBuildOutputPath(outputPath?: string): string {
  if (!outputPath) {
    return "dist";
  }
  const trimmed = outputPath.trim();
  return trimmed || "dist";
}

export function validateBuildOutput(
  outputPath: string = process.env.BUILD_PATH || "dist",
  cwd: string = process.cwd(),
): string {
  const targetPath = resolveBuildOutputPath(outputPath);
  const targetDir = path.resolve(cwd, targetPath);

  let stat: fs.Stats;
  try {
    if (!fs.existsSync(targetDir)) {
      throw new Error(`Configured build output directory '${targetPath}' does not exist.`);
    }
    stat = fs.statSync(targetDir);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Configured build output")) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to access configured build output path '${targetPath}': ${msg}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Configured build output path '${targetPath}' is not a directory.`);
  }

  let files: string[];
  try {
    files = fs.readdirSync(targetDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read configured build output directory '${targetPath}': ${msg}`);
  }

  if (files.length === 0) {
    throw new Error(`Configured build output directory '${targetPath}' is empty.`);
  }

  return targetPath;
}

function handleBuildFailure(message: string, exitCode: number, exitOnFailure: boolean): number {
  core.setFailed(message);
  if (exitOnFailure) {
    process.exit(exitCode);
  }
  return exitCode;
}

async function executeParsedCommand(parsed: ParsedCommand): Promise<number> {
  core.info(`Executing build command: ${parsed.command}`);

  return await exec.exec(parsed.command, parsed.args, {
    ignoreReturnCode: true,
  });
}

export async function runBuildCommand(options?: RunBuildCommandOptions): Promise<number> {
  const exitOnFailure = options?.exitOnFailure ?? true;
  const pm = process.env.PACKAGE_MANAGER || "npm";

  let commandToParse: string;
  try {
    commandToParse = await resolveBuildCommandToParse(
      process.env.BUILD_COMMAND,
      process.env.DEFAULT_BUILD_COMMAND,
      pm,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleBuildFailure(`Failed to resolve build command: ${msg}`, 1, exitOnFailure);
  }

  core.info("Preparing build command execution.");

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(commandToParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleBuildFailure(`Failed to parse build command: ${msg}`, 1, exitOnFailure);
  }

  let exitCode = 0;
  try {
    exitCode = await executeParsedCommand(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleBuildFailure(`Failed to execute build command: ${msg}`, 1, exitOnFailure);
  }

  if (exitCode !== 0) {
    return handleBuildFailure(
      `Build command execution failed with exit code ${exitCode}.`,
      exitCode,
      exitOnFailure,
    );
  }

  try {
    const resolvedPath = resolveBuildOutputPath(process.env.BUILD_PATH);
    validateBuildOutput(resolvedPath);
    core.setOutput("path", resolvedPath);
    core.info(`Build output directory validation succeeded for '${resolvedPath}'.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return handleBuildFailure(`Build output validation failed: ${msg}`, 1, exitOnFailure);
  }

  return 0;
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
      const resolvedPath = validateBuildOutput();
      core.setOutput("path", resolvedPath);
      core.info(`Build output directory validation succeeded for '${resolvedPath}'.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.setFailed(msg);
      process.exit(1);
    }
  } else {
    runBuildCommand().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      core.setFailed(`Unhandled error during build command execution: ${msg}`);
      process.exit(1);
    });
  }
}
