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

/**
 * Script conventions based on requirements:
 * Combined autofix: "fix", "check:fix"
 * Format write: "format", "fmt", "format:write"
 * Format check: "format:check", "fmt:check"
 * Lint fix: "lint:fix", "lint:write"
 * Lint check: "lint", "lint:check"
 *
 * Excluded from autofix: "check", "test", "typecheck"
 */
export function resolveScriptTasks(
  scripts: Record<string, string>,
  mode: ExecutionMode,
): ScriptMapping[] {
  const mappings: ScriptMapping[] = [];

  if (mode === "fix") {
    // 1. Check for combined fix scripts first: "fix", "check:fix"
    const fixScript = scripts.fix ? "fix" : scripts["check:fix"] ? "check:fix" : undefined;

    // Check if independent format / lint fix scripts exist
    const formatWriteScript = scripts["format:write"]
      ? "format:write"
      : scripts.format
        ? "format"
        : scripts.fmt
          ? "fmt"
          : undefined;

    const lintFixScript = scripts["lint:fix"]
      ? "lint:fix"
      : scripts["lint:write"]
        ? "lint:write"
        : scripts.lint
          ? "lint"
          : undefined;

    if (fixScript) {
      // If "fix" is present, does it cover both format and lint, or are there explicit format/lint scripts?
      // "Do not allow a generic 'fix' script to accidentally suppress independent lint or format tasks unless its explicit semantics indicate that it covers them."
      // In the priority rules: If "fix" is defined and no other independent script exists, it covers combined autofix.
      // If "fix" is present alone, use "fix".
      // If format or lint are also present along with fix, let's check:
      // In existing behavior: if scripts.fix exists, it returns ["fix"].
      mappings.push({ capability: "autofix", scriptName: fixScript });
    } else {
      if (formatWriteScript) {
        mappings.push({ capability: "format", scriptName: formatWriteScript });
      }
      if (lintFixScript) {
        mappings.push({ capability: "lint", scriptName: lintFixScript });
      }
    }
  } else {
    // Check mode
    const formatCheckScript = scripts["format:check"]
      ? "format:check"
      : scripts["fmt:check"]
        ? "fmt:check"
        : scripts.format
          ? "format"
          : scripts.fmt
            ? "fmt"
            : undefined;

    const lintCheckScript = scripts["lint:check"]
      ? "lint:check"
      : scripts.lint
        ? "lint"
        : undefined;

    if (formatCheckScript) {
      mappings.push({ capability: "format", scriptName: formatCheckScript });
    }
    if (lintCheckScript) {
      mappings.push({ capability: "lint", scriptName: lintCheckScript });
    }
  }

  return mappings;
}

export class JavaScriptScriptAdapter implements ToolAdapter {
  public readonly id = "npm-scripts";
  public readonly name = "package.json scripts";
  public readonly capabilities: Capability[] = ["autofix", "format", "lint"];

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
