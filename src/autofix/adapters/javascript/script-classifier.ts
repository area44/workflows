import { delegatesToScript, extractDelegatedTarget } from "./delegation-analyzer";
import {
  inspectAndTokenizeCommandLine,
  getCommandInvocationTokens,
  extractShellWrapperScript,
} from "./shell-parser";

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

  if (hasWriteFlag(tokens)) {
    return "write-capable";
  }

  const wrappedScript = extractShellWrapperScript(tokens);
  if (wrappedScript !== undefined) {
    return classifyScriptInternal(wrappedScript, scripts, activePath);
  }

  const target = extractDelegatedTarget(tokens);
  if (target) {
    if (activePath.has(target)) return "unknown";
    const targetScript = scripts[target];
    if (!targetScript) return "unknown";
    activePath.add(target);
    try {
      return classifyScriptInternal(targetScript, scripts, activePath);
    } finally {
      activePath.delete(target);
    }
  }

  if (isKnownWriteCommand(tokens)) {
    return "write-capable";
  }

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
  const { commands, hasSyntaxError } = splitChainedCommandsDetailed(command);
  if (hasSyntaxError) {
    return "unknown";
  }

  if (commands.length === 0) return "unknown";

  let hasReadOnly = false;

  for (const cmd of commands) {
    const inspection = inspectAndTokenizeCommandLine(cmd);
    const tokens = getCommandInvocationTokens(inspection.tokens);
    const classification = classifyInvocation(tokens, scripts, activePath);

    if (classification === "write-capable") {
      return "write-capable";
    }

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
  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(command);
  if (hasSyntaxError) {
    return false;
  }
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
  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(command);
  if (hasSyntaxError) {
    return false;
  }
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
  const { invocations, hasSyntaxError } = parseCommandInvocationsDetailed(command);
  if (hasSyntaxError) {
    return false;
  }
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

import { splitChainedCommandsDetailed } from "./shell-parser";
import { parseCommandInvocationsDetailed } from "./shell-parser";

export type ScriptClassification = "read-only" | "write-capable" | "unknown";

export function resolveFormatFixCandidate(scripts: Record<string, string>): string | undefined {
  const candidates = ["format:write", "format:fix", "format", "fmt"];
  for (const name of candidates) {
    if (scripts[name] && hasVerifiedFormattingCommand(scripts[name], scripts)) {
      return name;
    }
  }
  return undefined;
}

export function resolveFormatCheckCandidate(scripts: Record<string, string>): string | undefined {
  if (scripts["format:check"] && classifyScript(scripts["format:check"], scripts) === "read-only") {
    return "format:check";
  }
  if (scripts["fmt:check"] && classifyScript(scripts["fmt:check"], scripts) === "read-only") {
    return "fmt:check";
  }
  return undefined;
}

export function resolveFormatScript(
  scripts: Record<string, string>,
  mode: "fix" | "check",
): string | undefined {
  if (mode === "fix") {
    return resolveFormatFixCandidate(scripts);
  }
  return resolveFormatCheckCandidate(scripts);
}

export function resolveLintScript(
  scripts: Record<string, string>,
  mode: "fix" | "check",
): string | undefined {
  if (mode === "fix") {
    if (scripts["lint:fix"]) return "lint:fix";
    if (scripts["lint:write"]) return "lint:write";
    return undefined;
  }
  if (scripts["lint:check"] && classifyScript(scripts["lint:check"], scripts) === "read-only") {
    return "lint:check";
  }
  if (scripts.lint && classifyScript(scripts.lint, scripts) === "read-only") {
    return "lint";
  }
  return undefined;
}

export {
  hasVerifiedFormattingCommand,
  hasVerifiedLintingCommand,
  hasVerifiedFullCheckCommand,
  checkCoverage,
};
