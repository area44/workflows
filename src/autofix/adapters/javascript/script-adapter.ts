import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "../../types.js";

import { sanitizePackageManager } from "../../../javascript-env.js";

export interface ScriptMapping {
  capability: Capability;
  capabilities?: readonly Capability[];
  scriptName: string;
}

export type ScriptClassification = "read-only" | "write-capable" | "unknown";

function resolveFormatFixCandidate(scripts: Record<string, string>): string | undefined {
  const candidates = ["format:write", "format:fix", "format", "fmt"];
  for (const name of candidates) {
    if (scripts[name] && hasVerifiedFormattingCommand(scripts[name], scripts)) {
      return name;
    }
  }
  return undefined;
}

function resolveFormatCheckCandidate(scripts: Record<string, string>): string | undefined {
  // In check mode, positively require scripts to be "read-only".
  // Fall back to "fmt:check" when "format:check" is missing or cannot be safely verified as read-only.
  if (scripts["format:check"] && classifyScript(scripts["format:check"], scripts) === "read-only") {
    return "format:check";
  }
  if (scripts["fmt:check"] && classifyScript(scripts["fmt:check"], scripts) === "read-only") {
    return "fmt:check";
  }
  return undefined;
}

function resolveFormatScript(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): string | undefined {
  if (mode === "fix") {
    return resolveFormatFixCandidate(scripts);
  }
  return resolveFormatCheckCandidate(scripts);
}

function resolveLintScript(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): string | undefined {
  if (mode === "fix") {
    // In fix mode, ONLY select scripts that clearly express an autofix or write operation.
    // Plain "lint", "lint:check", "check", "test", or "typecheck" are never run as autofix tasks!
    if (scripts["lint:fix"]) return "lint:fix";
    if (scripts["lint:write"]) return "lint:write";
    return undefined;
  }
  // In check mode, positively require scripts to be "read-only".
  // Reject unknown commands, unsupported shell wrappers, unresolved delegations, or write flags.
  if (scripts["lint:check"] && classifyScript(scripts["lint:check"], scripts) === "read-only") {
    return "lint:check";
  }
  if (scripts.lint && classifyScript(scripts.lint, scripts) === "read-only") {
    return "lint";
  }
  return undefined;
}

interface TokenizerState {
  inSingleQuote: boolean;
  inDoubleQuote: boolean;
  isEscaped: boolean;
}

interface SplitState extends TokenizerState {
  hasSyntaxError: boolean;
}

function getSeparatorLength(text: string, index: number, state: TokenizerState): number {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return 0;
  const ch = text[index];
  if (ch === ";" || ch === "\n") return 1;
  if (ch === "&" && text[index + 1] === "&") return 2;
  if (ch === "|" && text[index + 1] === "|") return 2;
  if (ch === "|") return 1;
  return 0;
}

function skipComment(text: string, index: number): number {
  let i = index;
  while (i < text.length && text[i] !== "\n") {
    i++;
  }
  return i > index ? i - 1 : index;
}

function isShellCommentStart(currentCmd: string, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return false;
  if (currentCmd.length === 0) return true;
  return /\s/.test(currentCmd[currentCmd.length - 1]);
}

interface SplitResult {
  commands: string[];
  hasSyntaxError: boolean;
}

function handleEscapeInSplit(ch: string, state: SplitState): { ch: string; advance: boolean } {
  state.isEscaped = false;
  return { ch, advance: true };
}

function processSplitChar(
  shellText: string,
  i: number,
  state: SplitState,
  currentCmd: string,
): { newCmd: string; nextIndex: number; sepLen: number } {
  const ch = shellText[i];

  if (state.isEscaped) {
    const res = handleEscapeInSplit(ch, state);
    return { newCmd: currentCmd + res.ch, nextIndex: i, sepLen: 0 };
  }

  if (ch === "\\" && !state.inSingleQuote) {
    state.isEscaped = true;
    return { newCmd: currentCmd + ch, nextIndex: i, sepLen: 0 };
  }

  if (ch === "'" && !state.inDoubleQuote) {
    state.inSingleQuote = !state.inSingleQuote;
    return { newCmd: currentCmd + ch, nextIndex: i, sepLen: 0 };
  }

  if (ch === '"' && !state.inSingleQuote) {
    state.inDoubleQuote = !state.inDoubleQuote;
    return { newCmd: currentCmd + ch, nextIndex: i, sepLen: 0 };
  }

  if (ch === "#" && isShellCommentStart(currentCmd, state)) {
    const nextIdx = skipComment(shellText, i);
    return { newCmd: currentCmd, nextIndex: nextIdx, sepLen: 0 };
  }

  const sepLen = getSeparatorLength(shellText, i, state);
  return { newCmd: currentCmd + (sepLen === 0 ? ch : ""), nextIndex: i, sepLen };
}

/**
 * Splits shell command text into chained commands (;, &&, ||, |, newline)
 * while respecting quotes ('...', "..."), escapes (\), and comments.
 * Tracks syntax errors such as unterminated quotes or trailing escape.
 */
function splitChainedCommandsDetailed(shellText: string): SplitResult {
  const commands: string[] = [];
  let currentCmd = "";
  const state: SplitState = {
    inSingleQuote: false,
    inDoubleQuote: false,
    isEscaped: false,
    hasSyntaxError: false,
  };

  for (let i = 0; i < shellText.length; i++) {
    const processed = processSplitChar(shellText, i, state, currentCmd);
    if (processed.sepLen > 0) {
      if (currentCmd.trim()) commands.push(currentCmd.trim());
      currentCmd = "";
      i += processed.sepLen - 1;
      continue;
    }
    currentCmd = processed.newCmd;
    i = processed.nextIndex;
  }

  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) {
    state.hasSyntaxError = true;
  }

  if (currentCmd.trim()) {
    commands.push(currentCmd.trim());
  }

  return { commands, hasSyntaxError: state.hasSyntaxError };
}

export function splitChainedCommands(shellText: string): string[] {
  return splitChainedCommandsDetailed(shellText).commands;
}

function handleEscapeInWord(ch: string, state: TokenizerState, currentWord: string): string {
  state.isEscaped = false;
  return currentWord + ch;
}

function handleQuoteToggle(ch: string, state: TokenizerState): boolean {
  if (ch === "'" && !state.inDoubleQuote) {
    state.inSingleQuote = !state.inSingleQuote;
    return true;
  }
  if (ch === '"' && !state.inSingleQuote) {
    state.inDoubleQuote = !state.inDoubleQuote;
    return true;
  }
  return false;
}

const SPECIAL_PARAMETERS = new Set(["@", "*", "#", "?", "-", "$", "!", "0"]);

function isParameterExpansionStart(cmd: string, index: number, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.isEscaped) return false;
  if (cmd[index] !== "$") return false;
  if (index + 1 >= cmd.length) return false;

  const next = cmd[index + 1];

  // Braced parameter expansion: ${...}
  if (next === "{") return true;

  // Positional parameters: $1, $2, etc. or special parameters: $@, $*, $#, $?, $-, $$, $!, $0
  if (SPECIAL_PARAMETERS.has(next) || (next >= "1" && next <= "9")) {
    return true;
  }

  // Shell variable identifier: starts with letter or underscore
  if (next === "_" || (next >= "a" && next <= "z") || (next >= "A" && next <= "Z")) {
    return true;
  }

  return false;
}

interface CommandInspection {
  tokens: string[];
  hasUnsupportedSyntax: boolean;
  hasRedirection: boolean;
  hasSyntaxError: boolean;
}

function isBackgroundOp(cmd: string, index: number, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return false;
  if (cmd[index] !== "&") return false;
  const prev = index > 0 ? cmd[index - 1] : "";
  const next = index + 1 < cmd.length ? cmd[index + 1] : "";
  return prev !== "&" && next !== "&" && next !== ">";
}

function isCommandSubstitutionStart(cmd: string, index: number, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.isEscaped) return false;
  const ch = cmd[index];
  if (ch === "`") return true;
  if (ch === "$" && index + 1 < cmd.length && cmd[index + 1] === "(") return true;
  return false;
}

function isProcessSubstitutionStart(cmd: string, index: number, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return false;
  const ch = cmd[index];
  if ((ch === "<" || ch === ">") && index + 1 < cmd.length && cmd[index + 1] === "(") {
    return true;
  }
  return false;
}

function isRedirectionChar(cmd: string, index: number, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return false;
  const ch = cmd[index];
  if (ch === ">") return true;
  if (ch === "<") return true;
  if (ch === "&" && index + 1 < cmd.length && cmd[index + 1] === ">") return true;
  return false;
}

interface TokenizeScanContext {
  inspection: CommandInspection;
  state: TokenizerState;
}

function inspectSpecialConstructs(cmd: string, i: number, ctx: TokenizeScanContext): boolean {
  if (isBackgroundOp(cmd, i, ctx.state)) {
    ctx.inspection.hasUnsupportedSyntax = true;
    return true;
  }
  if (isParameterExpansionStart(cmd, i, ctx.state)) {
    ctx.inspection.hasUnsupportedSyntax = true;
    return true;
  }
  if (isCommandSubstitutionStart(cmd, i, ctx.state)) {
    ctx.inspection.hasUnsupportedSyntax = true;
    return true;
  }
  if (isProcessSubstitutionStart(cmd, i, ctx.state)) {
    ctx.inspection.hasUnsupportedSyntax = true;
    return true;
  }
  if (isRedirectionChar(cmd, i, ctx.state)) {
    ctx.inspection.hasRedirection = true;
    ctx.inspection.hasUnsupportedSyntax = true;
    return true;
  }
  return false;
}

function stepTokenizeChar(
  cmd: string,
  i: number,
  ctx: TokenizeScanContext,
  currentWord: string,
): { word: string; hasChars: boolean; skipped: boolean } {
  const ch = cmd[i];

  if (ctx.state.isEscaped) {
    const word = handleEscapeInWord(ch, ctx.state, currentWord);
    return { word, hasChars: true, skipped: false };
  }

  if (ch === "\\" && !ctx.state.inSingleQuote) {
    ctx.state.isEscaped = true;
    return { word: currentWord, hasChars: false, skipped: true };
  }

  inspectSpecialConstructs(cmd, i, ctx);

  if (handleQuoteToggle(ch, ctx.state)) {
    return { word: currentWord, hasChars: true, skipped: true };
  }

  return { word: currentWord + ch, hasChars: true, skipped: false };
}

/**
 * Splits a single command line into word tokens, respecting quotes and escapes.
 * Detects unsupported shell constructs (backgrounding, command substitutions,
 * process substitutions, output/input redirections, unclosed quotes/escapes).
 */
function inspectAndTokenizeCommandLine(cmd: string): CommandInspection {
  const inspection: CommandInspection = {
    tokens: [],
    hasUnsupportedSyntax: false,
    hasRedirection: false,
    hasSyntaxError: false,
  };
  const state: TokenizerState = { inSingleQuote: false, inDoubleQuote: false, isEscaped: false };
  const ctx: TokenizeScanContext = { inspection, state };

  let currentWord = "";
  let hasCharsInWord = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (!state.inSingleQuote && !state.inDoubleQuote && !state.isEscaped && /\s/.test(ch)) {
      if (hasCharsInWord) {
        inspection.tokens.push(currentWord);
        currentWord = "";
        hasCharsInWord = false;
      }
      continue;
    }

    const step = stepTokenizeChar(cmd, i, ctx, currentWord);
    currentWord = step.word;
    if (step.hasChars) hasCharsInWord = true;
  }

  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) {
    inspection.hasUnsupportedSyntax = true;
    inspection.hasSyntaxError = true;
  }

  if (hasCharsInWord) {
    inspection.tokens.push(currentWord);
  }

  return inspection;
}

export function tokenizeCommandLine(cmd: string): string[] {
  return inspectAndTokenizeCommandLine(cmd).tokens;
}

const ENV_ASSIGNMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isEnvAssignment(token: string): boolean {
  return ENV_ASSIGNMENT_REGEX.test(token);
}

/**
 * Unwraps environment wrapper commands like `cross-env` or `cross-env-shell`,
 * stripping initial environment variable assignments to retrieve the target command tokens.
 * In accordance with cross-env CLI syntax, cross-env accepts environment variable
 * setters (`KEY=val`) followed by the command and its arguments.
 */
export function unwrapEnvironmentWrapper(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens;
  const [exe] = tokens;
  if (exe !== "cross-env" && exe !== "cross-env-shell") {
    return tokens;
  }

  let i = 1;
  while (i < tokens.length && isEnvAssignment(tokens[i])) {
    i++;
  }

  return tokens.slice(i);
}

/**
 * Normalizes command invocation tokens by stripping leading inline environment
 * variable assignments (e.g. `FOO=bar`) and unwrapping environment wrappers
 * (`cross-env`, `cross-env-shell`) along with any subsequent environment variable assignments.
 */
export function normalizeCommandTokens(tokens: string[]): string[] {
  let current = tokens;
  while (current.length > 0) {
    let startIndex = 0;
    while (startIndex < current.length && isEnvAssignment(current[startIndex])) {
      startIndex++;
    }
    current = current.slice(startIndex);

    if (current.length > 0 && (current[0] === "cross-env" || current[0] === "cross-env-shell")) {
      const unwrapped = unwrapEnvironmentWrapper(current);
      if (unwrapped === current) {
        break;
      }
      current = unwrapped;
    } else {
      break;
    }
  }
  return current;
}

function getCommandInvocationTokens(tokens: string[]): string[] {
  return normalizeCommandTokens(tokens);
}

function matchesPmDelegation(cmdTokens: string[], targetScriptName: string): boolean {
  if (cmdTokens.length === 0) return false;
  const [first, second, third] = cmdTokens;

  // Check `npm run <target>`, `pnpm run <target>`, `yarn run <target>`, `bun run <target>`
  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "run" &&
    third === targetScriptName
  ) {
    return true;
  }

  // Check `pnpm <target>`, `bun <target>`, `yarn <target>`
  if ((first === "pnpm" || first === "bun" || first === "yarn") && second === targetScriptName) {
    return true;
  }

  return false;
}

export interface ParsedCommandInvocations {
  invocations: string[][];
  hasSyntaxError: boolean;
}

export function parseCommandInvocationsDetailed(scriptBody: string): ParsedCommandInvocations {
  if (!scriptBody) return { invocations: [], hasSyntaxError: false };
  const splitResult = splitChainedCommandsDetailed(scriptBody);
  let hasSyntaxError = splitResult.hasSyntaxError;
  const invocations: string[][] = [];

  for (const cmd of splitResult.commands) {
    const inspection = inspectAndTokenizeCommandLine(cmd);
    if (inspection.hasSyntaxError) {
      hasSyntaxError = true;
    }
    const cmdTokens = getCommandInvocationTokens(inspection.tokens);
    if (cmdTokens.length > 0) {
      invocations.push(cmdTokens);
    }
  }

  return { invocations, hasSyntaxError };
}

export function parseCommandInvocations(scriptBody: string): string[][] {
  return parseCommandInvocationsDetailed(scriptBody).invocations;
}

/**
 * Recursively checks whether a script body or script reference delegates to a target script,
 * safely handling arbitrary depth, shell wrappers (`sh -c`, `bash -c`), and circular dependencies.
 */
export function delegatesToScript(
  scriptBodyOrName: string,
  targetScriptName: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  if (!scriptBodyOrName || !targetScriptName) return false;

  const scriptBody =
    scripts[scriptBodyOrName] !== undefined ? scripts[scriptBodyOrName] : scriptBodyOrName;

  const invocations = parseCommandInvocations(scriptBody);
  for (const tokens of invocations) {
    if (matchesPmDelegation(tokens, targetScriptName)) {
      return true;
    }

    const delegated = extractDelegatedTarget(tokens);
    if (delegated) {
      if (delegated === targetScriptName) return true;
      if (!activePath.has(delegated) && scripts[delegated] !== undefined) {
        activePath.add(delegated);
        try {
          if (delegatesToScript(scripts[delegated], targetScriptName, scripts, activePath)) {
            return true;
          }
        } finally {
          activePath.delete(delegated);
        }
      }
    }

    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      if (delegatesToScript(wrappedScript, targetScriptName, scripts, activePath)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recognizes actual supported package-manager script invocation commands:
 * e.g. `npm run format:write`, `pnpm run format`, `bun run lint:fix`, `yarn run lint:fix`, `pnpm format`, `bun format`,
 * including quoted script arguments (e.g. `npm run "format:write"`) and environment variable assignments.
 * Supports recursive inspection when scripts are provided.
 */
export function doesFixScriptDelegateTo(
  fixScriptBody: string,
  targetScriptName: string,
  scripts: Record<string, string> = {},
): boolean {
  return delegatesToScript(fixScriptBody, targetScriptName, scripts);
}

function shouldIncludeFormatWithFix(
  scripts: Record<string, string>,
  fixScript: string,
  formatScript?: string,
): boolean {
  if (!formatScript || formatScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !delegatesToScript(fixBody, formatScript, scripts);
}

function shouldIncludeLintWithFix(
  scripts: Record<string, string>,
  fixScript: string,
  lintScript?: string,
): boolean {
  if (!lintScript || lintScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !delegatesToScript(fixBody, lintScript, scripts);
}

function hasWriteFlag(tokens: string[]): boolean {
  const [exe] = tokens;
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      ((t === "--fix" || t.startsWith("--fix=")) && !(exe === "eslint" && t === "--fix-dry-run")),
  );
}

function isPrettierWrite(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "prettier") return false;
  return tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
}

function isOxfmtWrite(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxfmt") return false;
  return tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
}

function isBiomeFormatWrite(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "format") return false;
  return tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
}

function isEslintFix(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "eslint") return false;
  return tokens.some((t) => (t === "--fix" || t.startsWith("--fix=")) && t !== "--fix-dry-run");
}

function isOxlintFix(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxlint") return false;
  return tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function isBiomeLintWrite(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "lint") return false;
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix="),
  );
}

function isBiomeCheckWrite(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "check") return false;
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix="),
  );
}

function isVpFmtWrite(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "fmt") return false;
  // vp fmt is write-capable unless --check or -c is passed
  return !tokens.some((t) => t === "--check" || t === "-c");
}

function isVpLintFix(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "lint") return false;
  return tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function hasEslintWriteOption(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "--fix" ||
      (t.startsWith("--fix=") && t !== "--fix-dry-run") ||
      t === "-o" ||
      t.startsWith("-o=") ||
      t === "--output-file" ||
      t.startsWith("--output-file=") ||
      t === "--cache" ||
      t === "--cache-file" ||
      t.startsWith("--cache-file=") ||
      t === "--cache-location" ||
      t.startsWith("--cache-location="),
  );
}

function hasPrettierWriteOption(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--cache" ||
      t === "--cache-location" ||
      t.startsWith("--cache-location=") ||
      t === "--insert-pragma",
  );
}

function hasBiomeWriteOption(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix=") ||
      t === "--reporter-file" ||
      t.startsWith("--reporter-file=") ||
      t === "--log-file" ||
      t.startsWith("--log-file="),
  );
}

function hasOxlintWriteOption(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "--fix" ||
      t.startsWith("--fix=") ||
      t === "--fix-suggestions" ||
      t === "--fix-dangerously" ||
      t === "--init",
  );
}

function hasOxfmtWriteOption(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--init" ||
      t === "--migrate" ||
      t.startsWith("--migrate="),
  );
}

function isPrettierCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "prettier") return false;
  const hasCheck = tokens.some(
    (t) => t === "--check" || t === "-c" || t === "--list-different" || t === "-l",
  );
  return hasCheck && !hasPrettierWriteOption(tokens);
}

function isOxfmtCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxfmt") return false;
  const hasCheck = tokens.some((t) => t === "--check" || t === "-c");
  return hasCheck && !hasOxfmtWriteOption(tokens);
}

function isBiomeFormatCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "format") return false;
  return !hasBiomeWriteOption(tokens);
}

function isEslintCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "eslint") return false;
  return !hasEslintWriteOption(tokens);
}

function isOxlintCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxlint") return false;
  return !hasOxlintWriteOption(tokens);
}

function isBiomeLintCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "lint") return false;
  return !hasBiomeWriteOption(tokens);
}

function isBiomeCheckCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "check") return false;
  return !hasBiomeWriteOption(tokens);
}

function isVpFmtCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "fmt") return false;
  return tokens.some((t) => t === "--check" || t === "-c") && !hasOxfmtWriteOption(tokens);
}

function isVpLintCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "lint") return false;
  return !hasOxlintWriteOption(tokens);
}

function isVpCheckCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "check") return false;
  return !tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function extractDelegatedTarget(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;
  const [first, second, third] = tokens;
  if (
    (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") &&
    second === "run" &&
    third
  ) {
    return third;
  }
  if (
    (first === "pnpm" || first === "bun" || first === "yarn") &&
    second &&
    !second.startsWith("-")
  ) {
    return second;
  }
  return undefined;
}

export function extractShellWrapperScript(tokens: string[]): string | undefined {
  if (tokens.length >= 3 && (tokens[0] === "sh" || tokens[0] === "bash") && tokens[1] === "-c") {
    return tokens[2];
  }
  // When a command string is passed as a single quoted argument (e.g. from cross-env-shell),
  // recognize it as a shell script to be recursively parsed.
  if (
    tokens.length === 1 &&
    tokens[0].trim() !== "" &&
    (tokens[0].includes(" ") ||
      tokens[0].includes("\t") ||
      tokens[0].includes("\n") ||
      tokens[0].includes(";") ||
      tokens[0].includes("&") ||
      tokens[0].includes("|"))
  ) {
    return tokens[0];
  }
  return undefined;
}

/**
 * Checks whether an invocation (or nested wrapped invocations) executes the `vp` command.
 * Supports direct invocations, environment wrappers (cross-env), shell wrappers (sh -c, bash -c),
 * package-manager execution wrappers (npx, bunx, pnpm exec, etc.), and script delegations.
 */
export function hasVitePlusCommand(
  scriptBody: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  if (!scriptBody) return false;
  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(scriptBody);
  if (hasSyntaxError) {
    return false;
  }

  for (const tokens of invocations) {
    if (tokens.length === 0) continue;

    if (tokens[0] === "vp") {
      return true;
    }

    // Package-manager runner wrappers: npx vp, bunx vp, pnpm dlx vp, yarn dlx vp, npm exec vp, pnpm exec vp
    if ((tokens[0] === "npx" || tokens[0] === "bunx") && tokens[1] === "vp") {
      return true;
    }
    if (
      (tokens[0] === "npm" || tokens[0] === "pnpm" || tokens[0] === "yarn") &&
      (tokens[1] === "exec" || tokens[1] === "dlx") &&
      tokens[2] === "vp"
    ) {
      return true;
    }

    // Shell wrappers: sh -c "...", bash -c "..."
    const wrapped = extractShellWrapperScript(tokens);
    if (wrapped !== undefined) {
      if (hasVitePlusCommand(wrapped, scripts, activePath)) {
        return true;
      }
    }

    // Package-manager script delegation
    const target = extractDelegatedTarget(tokens);
    if (target && !activePath.has(target) && scripts[target]) {
      activePath.add(target);
      try {
        if (hasVitePlusCommand(scripts[target], scripts, activePath)) {
          return true;
        }
      } finally {
        activePath.delete(target);
      }
    }
  }

  return false;
}

function isKnownWriteCommand(tokens: string[]): boolean {
  return (
    isPrettierWrite(tokens) ||
    isOxfmtWrite(tokens) ||
    isBiomeFormatWrite(tokens) ||
    isEslintFix(tokens) ||
    isOxlintFix(tokens) ||
    isBiomeLintWrite(tokens) ||
    isBiomeCheckWrite(tokens) ||
    isVpFmtWrite(tokens) ||
    isVpLintFix(tokens)
  );
}

function isKnownReadOnlyCommand(tokens: string[]): boolean {
  return (
    isPrettierCheck(tokens) ||
    isOxfmtCheck(tokens) ||
    isBiomeFormatCheck(tokens) ||
    isEslintCheck(tokens) ||
    isOxlintCheck(tokens) ||
    isBiomeLintCheck(tokens) ||
    isBiomeCheckCheck(tokens) ||
    isVpFmtCheck(tokens) ||
    isVpLintCheck(tokens) ||
    isVpCheckCheck(tokens)
  );
}

function classifyInvocation(
  tokens: string[],
  scripts: Record<string, string>,
  activePath: Set<string>,
): ScriptClassification {
  if (tokens.length === 0) return "unknown";

  // Unconditionally reject write flags if present anywhere on unrecognized tools
  if (hasWriteFlag(tokens)) {
    return "write-capable";
  }

  // Shell wrappers: sh -c "...", bash -c "..."
  const wrappedScript = extractShellWrapperScript(tokens);
  if (wrappedScript !== undefined) {
    return classifyScriptInternal(wrappedScript, scripts, activePath);
  }

  // Package-manager script delegation
  const target = extractDelegatedTarget(tokens);
  if (target) {
    if (activePath.has(target)) return "unknown"; // true cycle detected
    const targetScript = scripts[target];
    if (!targetScript) return "unknown"; // unresolvable target
    activePath.add(target);
    try {
      return classifyScriptInternal(targetScript, scripts, activePath);
    } finally {
      activePath.delete(target);
    }
  }

  // Check known write-capable commands
  if (isKnownWriteCommand(tokens)) {
    return "write-capable";
  }

  // Check known read-only commands
  if (isKnownReadOnlyCommand(tokens)) {
    return "read-only";
  }

  return "unknown";
}

function classifyScriptInternal(
  command: string,
  scripts: Record<string, string>,
  activePath: Set<string>,
): ScriptClassification {
  const splitResult = splitChainedCommandsDetailed(command);
  if (splitResult.hasSyntaxError) {
    return "unknown";
  }

  const { commands } = splitResult;
  if (commands.length === 0) return "unknown";

  let hasReadOnly = false;

  for (const cmd of commands) {
    const inspection = inspectAndTokenizeCommandLine(cmd);
    const tokens = getCommandInvocationTokens(inspection.tokens);
    const classification = classifyInvocation(tokens, scripts, activePath);

    if (classification === "write-capable") {
      return "write-capable";
    }

    // Fail closed: If command contains unsupported shell syntax, redirections, or substitutions,
    // it must NEVER be classified as read-only.
    if (inspection.hasUnsupportedSyntax) {
      return "unknown";
    }

    if (classification === "unknown") {
      return "unknown";
    }
    if (classification === "read-only") {
      hasReadOnly = true;
    }
  }

  return hasReadOnly ? "read-only" : "unknown";
}

export function classifyScript(
  command: string,
  scripts: Record<string, string> = {},
): ScriptClassification {
  return classifyScriptInternal(command, scripts, new Set());
}

function hasVerifiedFormattingCommand(
  command: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (activePath.has(target)) return false;
      const targetScript = scripts[target];
      if (!targetScript) return false;
      activePath.add(target);
      try {
        return hasVerifiedFormattingCommand(targetScript, scripts, activePath);
      } finally {
        activePath.delete(target);
      }
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedFormattingCommand(wrappedScript, scripts, activePath);
    }
    return (
      isPrettierWrite(tokens) ||
      isOxfmtWrite(tokens) ||
      isBiomeFormatWrite(tokens) ||
      isVpFmtWrite(tokens)
    );
  });
}

function hasVerifiedLintingCommand(
  command: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (activePath.has(target)) return false;
      const targetScript = scripts[target];
      if (!targetScript) return false;
      activePath.add(target);
      try {
        return hasVerifiedLintingCommand(targetScript, scripts, activePath);
      } finally {
        activePath.delete(target);
      }
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedLintingCommand(wrappedScript, scripts, activePath);
    }
    return (
      isEslintFix(tokens) || isOxlintFix(tokens) || isBiomeLintWrite(tokens) || isVpLintFix(tokens)
    );
  });
}

function hasVerifiedFullCheckCommand(
  command: string,
  scripts: Record<string, string> = {},
  activePath: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (activePath.has(target)) return false;
      const targetScript = scripts[target];
      if (!targetScript) return false;
      activePath.add(target);
      try {
        return hasVerifiedFullCheckCommand(targetScript, scripts, activePath);
      } finally {
        activePath.delete(target);
      }
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedFullCheckCommand(wrappedScript, scripts, activePath);
    }
    if (isBiomeCheckWrite(tokens)) return true;
    const [exe, sub] = tokens;
    if (exe === "vp" && sub === "check") {
      return tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
    }
    return false;
  });
}

function checkCoverage(
  body: string,
  targetScript: string | undefined,
  scripts: Record<string, string>,
  hasCommand: (b: string) => boolean,
): boolean {
  if (targetScript && delegatesToScript(body, targetScript, scripts)) {
    return true;
  }
  return hasCommand(body);
}

function createFixScriptMappings(
  scripts: Record<string, string>,
  body: string,
  fixScript: string,
  formatScript: string | undefined,
  lintScript: string | undefined,
): ScriptMapping[] {
  const isFormat = checkCoverage(body, formatScript, scripts, (b) =>
    hasVerifiedFormattingCommand(b, scripts),
  );
  const isLint = checkCoverage(body, lintScript, scripts, (b) =>
    hasVerifiedLintingCommand(b, scripts),
  );
  const isFull = hasVerifiedFullCheckCommand(body, scripts);

  if (isFormat && isLint) {
    return [{ capability: "format", capabilities: ["format", "lint"], scriptName: fixScript }];
  }
  if (isFormat && !isFull) {
    return [{ capability: "format", scriptName: fixScript }];
  }
  if (isLint && !isFull) {
    return [{ capability: "lint", scriptName: fixScript }];
  }
  if (isFull) {
    return [{ capability: "autofix", scriptName: fixScript }];
  }
  return [{ capability: "typecheck", capabilities: [], scriptName: fixScript }];
}

function createFallbackFormatMapping(
  formatScript: string,
  scripts: Record<string, string>,
): ScriptMapping {
  const isVerified = hasVerifiedFormattingCommand(scripts[formatScript], scripts);
  return isVerified
    ? { capability: "format", scriptName: formatScript }
    : { capability: "typecheck", capabilities: [], scriptName: formatScript };
}

function createFallbackLintMapping(
  lintScript: string,
  scripts: Record<string, string>,
): ScriptMapping {
  const isVerified = hasVerifiedLintingCommand(scripts[lintScript], scripts);
  return isVerified
    ? { capability: "lint", scriptName: lintScript }
    : { capability: "typecheck", capabilities: [], scriptName: lintScript };
}

function resolveFixlessTasks(
  formatScript: string | undefined,
  lintScript: string | undefined,
  scripts: Record<string, string>,
): ScriptMapping[] {
  const fallback: ScriptMapping[] = [];
  if (formatScript) {
    fallback.push(createFallbackFormatMapping(formatScript, scripts));
  }
  if (lintScript) {
    fallback.push(createFallbackLintMapping(lintScript, scripts));
  }
  return fallback;
}

function appendIndependentFixTasks(
  mappings: ScriptMapping[],
  scripts: Record<string, string>,
  fixScript: string,
  formatScript: string | undefined,
  lintScript: string | undefined,
): void {
  if (formatScript && shouldIncludeFormatWithFix(scripts, fixScript, formatScript)) {
    mappings.push(createFallbackFormatMapping(formatScript, scripts));
  }
  if (lintScript && shouldIncludeLintWithFix(scripts, fixScript, lintScript)) {
    mappings.push(createFallbackLintMapping(lintScript, scripts));
  }
}

function resolveFixScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
  const fixScript = scripts.fix ? "fix" : scripts["check:fix"] ? "check:fix" : undefined;
  const formatScript = resolveFormatScript(scripts, "fix");
  const lintScript = resolveLintScript(scripts, "fix");

  if (!fixScript) {
    return resolveFixlessTasks(formatScript, lintScript, scripts);
  }

  const fixBody = scripts[fixScript] || "";
  const mappings = createFixScriptMappings(scripts, fixBody, fixScript, formatScript, lintScript);
  appendIndependentFixTasks(mappings, scripts, fixScript, formatScript, lintScript);
  return mappings;
}

function resolveCheckScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
  const mappings: ScriptMapping[] = [];
  const formatScript = resolveFormatScript(scripts, "check");
  const lintScript = resolveLintScript(scripts, "check");

  if (formatScript) {
    mappings.push({ capability: "format", scriptName: formatScript });
  }
  if (lintScript) {
    mappings.push({ capability: "lint", scriptName: lintScript });
  }

  return mappings;
}

export function resolveScriptTasks(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): ScriptMapping[] {
  return mode === "fix" ? resolveFixScriptTasks(scripts) : resolveCheckScriptTasks(scripts);
}

export class JavaScriptScriptAdapter implements ToolAdapter {
  public readonly id = "npm-scripts";
  public readonly name = "package.json scripts";
  public readonly capabilities: readonly Capability[] = ["autofix", "format", "lint"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const scripts = context.jsEnv?.packageJson?.scripts;
    if (!scripts || Object.keys(scripts).length === 0) {
      return { detected: false, reason: "no scripts declared in package.json" };
    }

    const fixTasks = resolveScriptTasks(scripts, "fix");
    const checkTasks = resolveScriptTasks(scripts, "check");
    const allTasks = [...fixTasks, ...checkTasks];

    if (allTasks.length > 0) {
      const uniqueNames = Array.from(new Set(allTasks.map((t) => `"${t.scriptName}"`))).join(", ");
      return { detected: true, reason: `found supported scripts: ${uniqueNames}` };
    }

    return {
      detected: false,
      reason: "no supported autofix or check scripts found in package.json",
    };
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    const scripts = context.jsEnv?.packageJson?.scripts || {};
    const scriptMappings = resolveScriptTasks(scripts, mode);

    const pm = sanitizePackageManager(context.jsPm || "npm");
    return scriptMappings.map((mapping) => ({
      id: `script-${mapping.scriptName}`,
      toolId: this.id,
      capability: mapping.capability,
      capabilities: mapping.capabilities,
      executable: pm,
      args: ["run", mapping.scriptName],
      cwd: context.cwd,
      mode,
      description: `package.json script: ${pm} run ${mapping.scriptName}`,
    }));
  }
}
