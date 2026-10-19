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

export function validateBuildOutput(
  outputPath: string = process.env.BUILD_PATH || "dist",
  cwd: string = process.cwd(),
): void {
  const targetPath = (outputPath || "dist").trim() || "dist";
  const targetDir = path.resolve(cwd, targetPath);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Configured build output directory '${targetPath}' does not exist.`);
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    throw new Error(`Configured build output path '${targetPath}' is not a directory.`);
  }

  const files = fs.readdirSync(targetDir);
  if (files.length === 0) {
    throw new Error(`Configured build output directory '${targetPath}' is empty.`);
  }
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
    core.setFailed(`Failed to resolve build command: ${msg}`);
    if (exitOnFailure) process.exit(1);
    return 1;
  }

  core.info(`Preparing build command: "${commandToParse}"`);

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(commandToParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Failed to parse build command "${commandToParse}": ${msg}`);
    if (exitOnFailure) process.exit(1);
    return 1;
  }

  const sanitizedArgs = parsed.args.map((a) => (a.includes(" ") ? `"${a}"` : a));
  const sanitizedDisplay = `${parsed.command} ${sanitizedArgs.join(" ")}`.trim();
  core.info(`Executing build command: ${sanitizedDisplay}`);

  let exitCode = 0;
  try {
    exitCode = await exec.exec(parsed.command, parsed.args, {
      ignoreReturnCode: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Failed to execute build command "${commandToParse}": ${msg}`);
    if (exitOnFailure) process.exit(1);
    return 1;
  }

  if (exitCode !== 0) {
    core.setFailed(`Build command failed with exit code ${exitCode}: ${commandToParse}`);
    if (exitOnFailure) process.exit(exitCode);
    return exitCode;
  }

  try {
    validateBuildOutput(process.env.BUILD_PATH || "dist");
    core.info("Build output directory validation succeeded.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(msg);
    if (exitOnFailure) process.exit(1);
    return 1;
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
      validateBuildOutput();
      core.info("Build output directory validation succeeded.");
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
