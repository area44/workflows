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

function splitChainedCommands(shellText: string): string[] {
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

interface CommandInspection {
  tokens: string[];
  hasUnsupportedSyntax: boolean;
  hasRedirection: boolean;
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
  }

  if (hasCharsInWord) {
    inspection.tokens.push(currentWord);
  }

  return inspection;
}

function tokenizeCommandLine(cmd: string): string[] {
  return inspectAndTokenizeCommandLine(cmd).tokens;
}

const ENV_ASSIGNMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isEnvAssignment(token: string): boolean {
  return ENV_ASSIGNMENT_REGEX.test(token);
}

function getCommandInvocationTokens(tokens: string[]): string[] {
  let startIndex = 0;
  while (startIndex < tokens.length && isEnvAssignment(tokens[startIndex])) {
    startIndex++;
  }
  return tokens.slice(startIndex);
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

export function parseCommandInvocations(scriptBody: string): string[][] {
  if (!scriptBody) return [];
  const commands = splitChainedCommands(scriptBody);
  const invocations: string[][] = [];
  for (const cmd of commands) {
    const rawTokens = tokenizeCommandLine(cmd);
    const cmdTokens = getCommandInvocationTokens(rawTokens);
    if (cmdTokens.length > 0) {
      invocations.push(cmdTokens);
    }
  }
  return invocations;
}

/**
 * Recognizes actual supported package-manager script invocation commands:
 * e.g. `npm run format:write`, `pnpm run format`, `bun run lint:fix`, `yarn run lint:fix`, `pnpm format`, `bun format`,
 * including quoted script arguments (e.g. `npm run "format:write"`) and environment variable assignments.
 * Does not match `echo format`, comments, quoted explanatory text, or substrings.
 */
export function doesFixScriptDelegateTo(fixScriptBody: string, targetScriptName: string): boolean {
  const invocations = parseCommandInvocations(fixScriptBody);
  for (const tokens of invocations) {
    if (matchesPmDelegation(tokens, targetScriptName)) {
      return true;
    }
  }
  return false;
}

function shouldIncludeFormatWithFix(
  scripts: Record<string, string>,
  fixScript: string,
  formatScript?: string,
): boolean {
  if (!formatScript || formatScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !doesFixScriptDelegateTo(fixBody, formatScript);
}

function shouldIncludeLintWithFix(
  scripts: Record<string, string>,
  fixScript: string,
  lintScript?: string,
): boolean {
  if (!lintScript || lintScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !doesFixScriptDelegateTo(fixBody, lintScript);
}

function hasWriteFlag(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix="),
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
  return tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
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

function isPrettierCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "prettier") return false;
  const hasCheck = tokens.some(
    (t) => t === "--check" || t === "-c" || t === "--list-different" || t === "-l",
  );
  const hasWrite = tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
  return hasCheck && !hasWrite;
}

function isOxfmtCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxfmt") return false;
  const hasCheck = tokens.some((t) => t === "--check" || t === "-c");
  const hasWrite = tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
  return hasCheck && !hasWrite;
}

function isBiomeFormatCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "format") return false;
  const hasWrite = tokens.some((t) => t === "-w" || t === "--write" || t.startsWith("--write="));
  return !hasWrite;
}

function isEslintCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "eslint") return false;
  return !tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function isOxlintCheck(tokens: string[]): boolean {
  const [exe] = tokens;
  if (exe !== "oxlint") return false;
  return !tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function isBiomeLintCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "lint") return false;
  return !tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix="),
  );
}

function isBiomeCheckCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "biome" || sub !== "check") return false;
  return !tokens.some(
    (t) =>
      t === "-w" ||
      t === "--write" ||
      t.startsWith("--write=") ||
      t === "--fix" ||
      t.startsWith("--fix="),
  );
}

function isVpFmtCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "fmt") return false;
  return tokens.some((t) => t === "--check" || t === "-c");
}

function isVpLintCheck(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "lint") return false;
  return !tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
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

function extractShellWrapperScript(tokens: string[]): string | undefined {
  if (tokens.length >= 3 && (tokens[0] === "sh" || tokens[0] === "bash") && tokens[1] === "-c") {
    return tokens[2];
  }
  return undefined;
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
  visited: Set<string>,
): ScriptClassification {
  if (tokens.length === 0) return "unknown";

  // Unconditionally reject write flags if present anywhere on unrecognized tools
  if (hasWriteFlag(tokens)) {
    return "write-capable";
  }

  // Shell wrappers: sh -c "...", bash -c "..."
  const wrappedScript = extractShellWrapperScript(tokens);
  if (wrappedScript !== undefined) {
    return classifyScriptInternal(wrappedScript, scripts, visited);
  }

  // Package-manager script delegation
  const target = extractDelegatedTarget(tokens);
  if (target) {
    if (visited.has(target)) return "unknown"; // cycle detected
    visited.add(target);
    const targetScript = scripts[target];
    if (!targetScript) return "unknown"; // unresolvable target
    return classifyScriptInternal(targetScript, scripts, visited);
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
  visited: Set<string>,
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
    const classification = classifyInvocation(tokens, scripts, visited);

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
  visited: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (visited.has(target)) return false;
      visited.add(target);
      const targetScript = scripts[target];
      return targetScript ? hasVerifiedFormattingCommand(targetScript, scripts, visited) : false;
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedFormattingCommand(wrappedScript, scripts, visited);
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
  visited: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (visited.has(target)) return false;
      visited.add(target);
      const targetScript = scripts[target];
      return targetScript ? hasVerifiedLintingCommand(targetScript, scripts, visited) : false;
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedLintingCommand(wrappedScript, scripts, visited);
    }
    return (
      isEslintFix(tokens) || isOxlintFix(tokens) || isBiomeLintWrite(tokens) || isVpLintFix(tokens)
    );
  });
}

function hasVerifiedFullCheckCommand(
  command: string,
  scripts: Record<string, string> = {},
  visited: Set<string> = new Set(),
): boolean {
  const invocations = parseCommandInvocations(command);
  return invocations.some((tokens) => {
    const target = extractDelegatedTarget(tokens);
    if (target) {
      if (visited.has(target)) return false;
      visited.add(target);
      const targetScript = scripts[target];
      return targetScript ? hasVerifiedFullCheckCommand(targetScript, scripts, visited) : false;
    }
    const wrappedScript = extractShellWrapperScript(tokens);
    if (wrappedScript !== undefined) {
      return hasVerifiedFullCheckCommand(wrappedScript, scripts, visited);
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
  hasCommand: (b: string) => boolean,
): boolean {
  if (targetScript && doesFixScriptDelegateTo(body, targetScript)) {
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
  const isFormat = checkCoverage(body, formatScript, (b) =>
    hasVerifiedFormattingCommand(b, scripts),
  );
  const isLint = checkCoverage(body, lintScript, (b) => hasVerifiedLintingCommand(b, scripts));
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
