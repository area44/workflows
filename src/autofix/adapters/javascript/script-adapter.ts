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

function resolveFormatScript(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): string | undefined {
  if (mode === "fix") {
    // Formatter scripts that modify files
    return scripts["format:write"]
      ? "format:write"
      : scripts["format:fix"]
        ? "format:fix"
        : scripts.format
          ? "format"
          : scripts.fmt
            ? "fmt"
            : undefined;
  }
  // In check mode, ONLY select explicitly non-writing scripts.
  // Never fall back to "format" or "fmt" as they typically perform file writes.
  return scripts["format:check"] ? "format:check" : scripts["fmt:check"] ? "fmt:check" : undefined;
}

function isWriteCapableScript(command: string): boolean {
  return /(?:^|\s)(?:--fix|--write)(?:$|\s)/.test(command);
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
  if (scripts["lint:check"]) {
    return "lint:check";
  }
  // In check mode, only select generic "lint" if it does not contain common write flags (--fix, --write)
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

function matchesPmDelegation(tokens: string[], targetScriptName: string): boolean {
  let startIndex = 0;
  while (startIndex < tokens.length && isEnvAssignment(tokens[startIndex])) {
    startIndex++;
  }

  if (startIndex >= tokens.length) {
    return false;
  }

  const first = tokens[startIndex];
  const second = tokens[startIndex + 1];
  const third = tokens[startIndex + 2];

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

/**
 * Recognizes actual supported package-manager script invocation commands:
 * e.g. `npm run format:write`, `pnpm run format`, `bun run lint:fix`, `yarn run lint:fix`, `pnpm format`, `bun format`,
 * including quoted script arguments (e.g. `npm run "format:write"`) and environment variable assignments.
 * Does not match `echo format`, comments, quoted explanatory text, or substrings.
 */
export function doesFixScriptDelegateTo(fixScriptBody: string, targetScriptName: string): boolean {
  if (!fixScriptBody) return false;

  const commands = splitChainedCommands(fixScriptBody);

  for (const cmd of commands) {
    const tokens = tokenizeCommandLine(cmd);
    if (tokens.length === 0) continue;

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

function hasFormattingCommand(body: string): boolean {
  return /\b(prettier|oxfmt|biome format)\b/.test(body);
}

function hasLintingCommand(body: string): boolean {
  return /\b(eslint|oxlint|biome lint)\b/.test(body);
}

function hasFullCheckCommand(body: string): boolean {
  return /\b(biome check|vp fmt|vp lint)\b/.test(body);
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
