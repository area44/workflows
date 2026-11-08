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

function resolveFormatScript(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): string | undefined {
  if (mode === "fix") {
    return resolveFormatFixCandidate(scripts);
  }
  // In check mode, positively require scripts to be "read-only".
  // Reject unknown commands, unsupported shell wrappers, unresolved package-manager delegations,
  // parser failures, and any script with write flags.
  const candidate = scripts["format:check"]
    ? "format:check"
    : scripts["fmt:check"]
      ? "fmt:check"
      : undefined;
  if (candidate && classifyScript(scripts[candidate], scripts) === "read-only") {
    return candidate;
  }
  return undefined;
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
  // Return index immediately before newline so outer loop processes the newline separator
  return i > index ? i - 1 : index;
}

function isShellCommentStart(currentCmd: string, state: TokenizerState): boolean {
  if (state.inSingleQuote || state.inDoubleQuote || state.isEscaped) return false;
  if (currentCmd.length === 0) return true;
  return /\s/.test(currentCmd[currentCmd.length - 1]);
}

/**
 * Splits shell command text into chained commands (;, &&, ||, |, newline)
 * while respecting quotes ('...', "..."), escapes (\), and comments.
 */
function splitChainedCommands(shellText: string): string[] {
  const commands: string[] = [];
  let currentCmd = "";
  const state: TokenizerState = { inSingleQuote: false, inDoubleQuote: false, isEscaped: false };

  for (let i = 0; i < shellText.length; i++) {
    const ch = shellText[i];

    if (state.isEscaped) {
      currentCmd += ch;
      state.isEscaped = false;
      continue;
    }

    if (ch === "\\" && !state.inSingleQuote) {
      state.isEscaped = true;
      currentCmd += ch;
      continue;
    }

    if (ch === "'" && !state.inDoubleQuote) {
      state.inSingleQuote = !state.inSingleQuote;
      currentCmd += ch;
      continue;
    }

    if (ch === '"' && !state.inSingleQuote) {
      state.inDoubleQuote = !state.inDoubleQuote;
      currentCmd += ch;
      continue;
    }

    if (ch === "#" && isShellCommentStart(currentCmd, state)) {
      i = skipComment(shellText, i);
      continue;
    }

    const sepLen = getSeparatorLength(shellText, i, state);
    if (sepLen > 0) {
      if (currentCmd.trim()) commands.push(currentCmd.trim());
      currentCmd = "";
      i += sepLen - 1;
      continue;
    }

    currentCmd += ch;
  }

  if (currentCmd.trim()) {
    commands.push(currentCmd.trim());
  }

  return commands;
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

/**
 * Splits a single command line into word tokens, respecting quotes and escapes.
 * Strips outer quotes so `"format:write"` or `'format:write'` becomes `format:write`.
 */
function tokenizeCommandLine(cmd: string): string[] {
  const tokens: string[] = [];
  let currentWord = "";
  let hasCharsInWord = false;
  const state: TokenizerState = { inSingleQuote: false, inDoubleQuote: false, isEscaped: false };

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (state.isEscaped) {
      currentWord = handleEscapeInWord(ch, state, currentWord);
      hasCharsInWord = true;
      continue;
    }

    if (ch === "\\" && !state.inSingleQuote) {
      state.isEscaped = true;
      continue;
    }

    if (handleQuoteToggle(ch, state)) {
      hasCharsInWord = true;
      continue;
    }

    if (!state.inSingleQuote && !state.inDoubleQuote && /\s/.test(ch)) {
      if (hasCharsInWord) {
        tokens.push(currentWord);
        currentWord = "";
        hasCharsInWord = false;
      }
      continue;
    }

    currentWord += ch;
    hasCharsInWord = true;
  }

  if (hasCharsInWord) {
    tokens.push(currentWord);
  }

  return tokens;
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
  if (
    isPrettierWrite(tokens) ||
    isOxfmtWrite(tokens) ||
    isBiomeFormatWrite(tokens) ||
    isEslintFix(tokens) ||
    isOxlintFix(tokens) ||
    isBiomeLintWrite(tokens) ||
    isBiomeCheckWrite(tokens) ||
    isVpFmtWrite(tokens) ||
    isVpLintFix(tokens)
  ) {
    return "write-capable";
  }

  // Check known read-only commands
  if (
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
  ) {
    return "read-only";
  }

  return "unknown";
}

function classifyScriptInternal(
  command: string,
  scripts: Record<string, string>,
  visited: Set<string>,
): ScriptClassification {
  const invocations = parseCommandInvocations(command);
  if (invocations.length === 0) return "unknown";

  let hasReadOnly = false;

  for (const tokens of invocations) {
    const classification = classifyInvocation(tokens, scripts, visited);
    if (classification === "write-capable") {
      return "write-capable";
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

function resolveFixScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
  const fixScript = scripts.fix ? "fix" : scripts["check:fix"] ? "check:fix" : undefined;
  const formatScript = resolveFormatScript(scripts, "fix");
  const lintScript = resolveLintScript(scripts, "fix");

  if (!fixScript) {
    const fallback: ScriptMapping[] = [];
    if (formatScript) {
      const isVerified = hasVerifiedFormattingCommand(scripts[formatScript], scripts);
      if (isVerified) {
        fallback.push({ capability: "format", scriptName: formatScript });
      } else {
        fallback.push({ capability: "typecheck", capabilities: [], scriptName: formatScript });
      }
    }
    if (lintScript) {
      const isVerified = hasVerifiedLintingCommand(scripts[lintScript], scripts);
      if (isVerified) {
        fallback.push({ capability: "lint", scriptName: lintScript });
      } else {
        fallback.push({ capability: "typecheck", capabilities: [], scriptName: lintScript });
      }
    }
    return fallback;
  }

  const fixBody = scripts[fixScript] || "";
  const mappings = createFixScriptMappings(scripts, fixBody, fixScript, formatScript, lintScript);

  if (formatScript && shouldIncludeFormatWithFix(scripts, fixScript, formatScript)) {
    const isVerified = hasVerifiedFormattingCommand(scripts[formatScript], scripts);
    mappings.push({
      capability: isVerified ? "format" : "typecheck",
      capabilities: isVerified ? ["format"] : [],
      scriptName: formatScript,
    });
  }
  if (lintScript && shouldIncludeLintWithFix(scripts, fixScript, lintScript)) {
    const isVerified = hasVerifiedLintingCommand(scripts[lintScript], scripts);
    mappings.push({
      capability: isVerified ? "lint" : "typecheck",
      capabilities: isVerified ? ["lint"] : [],
      scriptName: lintScript,
    });
  }

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
