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
  return scripts["format:check"]
    ? "format:check"
    : scripts["fmt:check"]
      ? "fmt:check"
      : scripts.format
        ? "format"
        : scripts.fmt
          ? "fmt"
          : undefined;
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
  return scripts["lint:check"] ? "lint:check" : scripts.lint ? "lint" : undefined;
}

/**
 * Recognizes actual supported package-manager script invocation commands:
 * e.g. `npm run format:write`, `pnpm run format`, `bun run lint:fix`, `yarn run lint:fix`, `pnpm format`, `bun format`
 * Does not match `echo format`, comments, quoted explanatory text, or substrings.
 */
export function doesFixScriptDelegateTo(fixScriptBody: string, targetScriptName: string): boolean {
  if (!fixScriptBody) return false;
  const escapedTarget = targetScriptName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  // Matches explicit package manager invocation:
  // e.g. npm run <target>, pnpm run <target>, bun run <target>, yarn run <target>, pnpm <target>, bun <target>
  const pattern = new RegExp(
    `(?:^|[;&|]|&&)\\s*(?:npm\\s+run|pnpm\\s+run|bun\\s+run|yarn\\s+run|pnpm|bun|yarn)\\s+${escapedTarget}(?:\\s+[^-;&|]+)*(?:\\s*([;&|]|&&)|$)`,
  );
  return pattern.test(fixScriptBody.trim());
}

function shouldIncludeIndependentFormat(
  scripts: Record<string, string>,
  fixScript: string,
  formatScript?: string,
): boolean {
  if (!formatScript || formatScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !doesFixScriptDelegateTo(fixBody, formatScript);
}

function shouldIncludeIndependentLint(
  scripts: Record<string, string>,
  fixScript: string,
  lintScript?: string,
): boolean {
  if (!lintScript || lintScript === fixScript) return false;
  const fixBody = scripts[fixScript] || "";
  return !doesFixScriptDelegateTo(fixBody, lintScript);
}

function resolveFixScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
  const fixScript = scripts.fix ? "fix" : scripts["check:fix"] ? "check:fix" : undefined;
  const formatScript = resolveFormatScript(scripts, "fix");
  const lintScript = resolveLintScript(scripts, "fix");

  if (!fixScript) {
    const fallbackMappings: ScriptMapping[] = [];
    if (formatScript) fallbackMappings.push({ capability: "format", scriptName: formatScript });
    if (lintScript) fallbackMappings.push({ capability: "lint", scriptName: lintScript });
    return fallbackMappings;
  }

  const mappings: ScriptMapping[] = [{ capability: "autofix", scriptName: fixScript }];
  if (formatScript && shouldIncludeIndependentFormat(scripts, fixScript, formatScript)) {
    mappings.push({ capability: "format", scriptName: formatScript });
  }
  if (lintScript && shouldIncludeIndependentLint(scripts, fixScript, lintScript)) {
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

    const tasks = resolveScriptTasks(scripts, "fix");
    if (tasks.length > 0) {
      const scriptNames = tasks.map((t) => `"${t.scriptName}"`).join(", ");
      return { detected: true, reason: `found autofix scripts: ${scriptNames}` };
    }

    return { detected: false, reason: "no supported autofix scripts found in package.json" };
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    const scripts = context.jsEnv?.packageJson?.scripts || {};
    const scriptMappings = resolveScriptTasks(scripts, mode);

    const pm = sanitizePackageManager(context.jsPm || "npm");
    return scriptMappings.map((mapping) => ({
      id: `script-${mapping.scriptName}`,
      toolId: this.id,
      capability: mapping.capability,
      executable: pm,
      args: ["run", mapping.scriptName],
      cwd: context.cwd,
      mode,
      description: `package.json script: ${pm} run ${mapping.scriptName}`,
    }));
  }
}
