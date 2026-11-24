import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";

import { sanitizePackageManager } from "@/javascript-env";

import { resolveScriptTasks } from "./index";

export type { ScriptMapping, ScriptClassification } from "./index";

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
    return scriptMappings.map((mapping) => {
      const scriptName = mapping.scriptName;
      return {
        id: `script-${scriptName}`,
        toolId: this.id,
        capability: mapping.capability,
        capabilities: mapping.capabilities,
        executable: pm,
        args: ["run", scriptName],
        cwd: context.cwd,
        mode,
        description: `package.json script: ${pm} run ${scriptName}`,
        resolution: "passthrough",
        formatFailure: (displayCmd: string) =>
          `Script "${scriptName}" failed while executing "${displayCmd}".`,
      };
    });
  }
}
