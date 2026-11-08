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

function isWriteCapableScript(command: string): boolean {
  const invocations = parseCommandInvocations(command);
  if (invocations.length === 0) return false;
  return invocations.some((tokens) => {
    const [exe] = tokens;
    if (exe === "echo" || exe === "printf") return false;
    return (
      isPrettierWrite(tokens) ||
      isOxfmtWrite(tokens) ||
      isBiomeFormatWrite(tokens) ||
      isEslintFix(tokens) ||
      isOxlintFix(tokens) ||
      isBiomeLintWrite(tokens) ||
      isBiomeCheckWrite(tokens) ||
      isVpFmt(tokens) ||
      isVpLintFix(tokens) ||
      hasWriteFlag(tokens)
    );
  });
}

function isExplicitReadonlyFormattingCommand(command: string): boolean {
  // Reject scripts that explicitly perform read-only check operations
  return (
    /\b(prettier|oxfmt|biome\s+format)\b/.test(command) &&
    /(?:^|\s)(?:--check|-c)(?:$|\s)/.test(command)
  );
}

function resolveFormatFixCandidate(scripts: Record<string, string>): string | undefined {
  if (scripts["format:write"]) return "format:write";
  if (scripts["format:fix"]) return "format:fix";
  // For generic format / fmt, select unless explicitly read-only (e.g. prettier --check)
  if (scripts.format && !isExplicitReadonlyFormattingCommand(scripts.format)) return "format";
  if (scripts.fmt && !isExplicitReadonlyFormattingCommand(scripts.fmt)) return "fmt";
  return undefined;
}

function resolveFormatScript(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): string | undefined {
  if (mode === "fix") {
    return resolveFormatFixCandidate(scripts);
  }
  // In check mode, ONLY select explicitly non-writing scripts.
  // Reject scripts containing recognized write flags (--write, -w, --fix).
  const candidate = scripts["format:check"]
    ? "format:check"
    : scripts["fmt:check"]
      ? "fmt:check"
      : undefined;
  if (candidate && !isWriteCapableScript(scripts[candidate])) {
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
  // In check mode, validate that the selected script does not contain write flags (--fix, --write)
  if (scripts["lint:check"] && !isWriteCapableScript(scripts["lint:check"])) {
    return "lint:check";
  }
  if (scripts.lint && !isWriteCapableScript(scripts.lint)) {
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

function isVpFmt(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  return exe === "vp" && sub === "fmt";
}

function isVpLintFix(tokens: string[]): boolean {
  const [exe, sub] = tokens;
  if (exe !== "vp" || sub !== "lint") return false;
  return tokens.some((t) => t === "--fix" || t.startsWith("--fix="));
}

function hasFormattingCommand(body: string): boolean {
  const invocations = parseCommandInvocations(body);
  return invocations.some(
    (tokens) =>
      isPrettierWrite(tokens) ||
      isOxfmtWrite(tokens) ||
      isBiomeFormatWrite(tokens) ||
      isVpFmt(tokens),
  );
}

function hasLintingCommand(body: string): boolean {
  const invocations = parseCommandInvocations(body);
  return invocations.some(
    (tokens) =>
      isEslintFix(tokens) || isOxlintFix(tokens) || isBiomeLintWrite(tokens) || isVpLintFix(tokens),
  );
}

function hasFullCheckCommand(body: string): boolean {
  const invocations = parseCommandInvocations(body);
  return invocations.some((tokens) => isBiomeCheckWrite(tokens));
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
  body: string,
  fixScript: string,
  formatScript: string | undefined,
  lintScript: string | undefined,
): ScriptMapping[] {
  const isFormat = checkCoverage(body, formatScript, hasFormattingCommand);
  const isLint = checkCoverage(body, lintScript, hasLintingCommand);
  const isFull = hasFullCheckCommand(body);

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
    if (formatScript) fallback.push({ capability: "format", scriptName: formatScript });
    if (lintScript) fallback.push({ capability: "lint", scriptName: lintScript });
    return fallback;
  }

  const fixBody = scripts[fixScript] || "";
  const mappings = createFixScriptMappings(fixBody, fixScript, formatScript, lintScript);

  if (formatScript && shouldIncludeFormatWithFix(scripts, fixScript, formatScript)) {
    mappings.push({ capability: "format", scriptName: formatScript });
  }
  if (lintScript && shouldIncludeLintWithFix(scripts, fixScript, lintScript)) {
    mappings.push({ capability: "lint", scriptName: lintScript });
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
