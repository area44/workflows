import type { ExecutionMode, Capability } from "@/autofix/types";

export interface ScriptMapping {
  capability: Capability;
  capabilities?: Capability[];
  scriptName: string;
}

import { delegatesToScript } from "./delegation-analyzer";
import {
  resolveFormatScript,
  resolveLintScript,
  hasVerifiedFormattingCommand,
  hasVerifiedLintingCommand,
  hasVerifiedFullCheckCommand,
  checkCoverage,
} from "./script-classifier";

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

export function resolveFixScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
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

export function resolveCheckScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
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
