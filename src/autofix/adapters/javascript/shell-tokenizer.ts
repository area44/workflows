export interface TokenizerState {
  inSingleQuote: boolean;
  inDoubleQuote: boolean;
  isEscaped: boolean;
}

export interface SplitState extends TokenizerState {
  hasSyntaxError: boolean;
}

export interface SplitResult {
  commands: string[];
  hasSyntaxError: boolean;
}

export interface CommandInspection {
  tokens: string[];
  hasUnsupportedSyntax: boolean;
  hasRedirection: boolean;
  hasSyntaxError: boolean;
}

interface TokenizeScanContext {
  inspection: CommandInspection;
  state: TokenizerState;
}

const SPECIAL_PARAMETERS = new Set(["@", "*", "#", "?", "-", "$", "!", "0"]);

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
export function splitChainedCommandsDetailed(shellText: string): SplitResult {
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
export function inspectAndTokenizeCommandLine(cmd: string): CommandInspection {
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

export function isEnvAssignment(token: string): boolean {
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
      if (unwrapped.length === current.length) break;
      current = unwrapped;
      continue;
    }
    break;
  }
  return current;
}