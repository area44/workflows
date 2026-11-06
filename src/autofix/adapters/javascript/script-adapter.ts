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
    return scripts["format:write"]
      ? "format:write"
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
    // In fix mode, prefer scripts explicitly indicating modifications:
    // lint:fix, lint:write.
    // If only lint is defined (and neither lint:fix nor lint:check exist),
    // and format/fmt is also defined in supported script conventions,
    // "lint" is recognized for compatibility with legacy test suites / conventions.
    // However, standalone "lint:check" is never run in fix mode.
    if (scripts["lint:fix"]) return "lint:fix";
    if (scripts["lint:write"]) return "lint:write";
    if (scripts.lint && !scripts["lint:check"]) return "lint";
    return undefined;
  }
  return scripts["lint:check"] ? "lint:check" : scripts.lint ? "lint" : undefined;
}

function resolveFixScriptTasks(scripts: Record<string, string>): ScriptMapping[] {
  const mappings: ScriptMapping[] = [];
  const fixScript = scripts.fix ? "fix" : scripts["check:fix"] ? "check:fix" : undefined;
  const formatScript = resolveFormatScript(scripts, "fix");
  const lintScript = resolveLintScript(scripts, "fix");

  if (fixScript) {
    mappings.push({ capability: "autofix", scriptName: fixScript });
    // If independent format or lint scripts exist, check if fix delegates to them or if they should run
    // When a project defines both "fix" and independent format / lint scripts:
    // If fix is "fix", check whether it covers them:
    const fixBody = scripts[fixScript] || "";
    const coversFormat =
      fixBody.includes(formatScript || "") || fixBody.includes("format") || fixBody.includes("fmt");
    const coversLint = fixBody.includes(lintScript || "") || fixBody.includes("lint");

    // Only add independent scripts if fix does not already cover them
    if (
      formatScript &&
      formatScript !== fixScript &&
      !coversFormat &&
      (scripts["format:write"] || !scripts.fix)
    ) {
      mappings.push({ capability: "format", scriptName: formatScript });
    }
    if (
      lintScript &&
      lintScript !== fixScript &&
      !coversLint &&
      (scripts["lint:fix"] || scripts["lint:write"])
    ) {
      mappings.push({ capability: "lint", scriptName: lintScript });
    }
  } else {
    if (formatScript) {
      mappings.push({ capability: "format", scriptName: formatScript });
    }
    if (lintScript) {
      mappings.push({ capability: "lint", scriptName: lintScript });
    }
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

  public getCapabilities(context: ProjectContext, mode: ExecutionMode = "fix"): Capability[] {
    const scripts = context.jsEnv?.packageJson?.scripts;
    if (!scripts) return [];
    const tasks = resolveScriptTasks(scripts, mode);
    return Array.from(new Set(tasks.map((t) => t.capability)));
  }

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
