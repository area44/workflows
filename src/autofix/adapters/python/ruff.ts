import * as io from "@actions/io";

import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "../../types.js";

export class RuffAdapter implements ToolAdapter {
  public readonly id = "ruff";
  public readonly name = "Ruff";
  public readonly capabilities: Capability[] = ["lint", "format"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    // Ruff is the default toolchain whenever Python source code is detected
    const hasSource = context.hasPythonSource ?? false;
    if (hasSource) {
      return { detected: true, reason: "default Python toolchain" };
    }
    return { detected: false, reason: "no Python source files detected" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const hasRuff = Boolean(await io.which("ruff", false));
    if (!hasRuff) {
      throw new Error("Required Python binary 'ruff' is not available in PATH.");
    }

    const tasks: ExecutionTask[] = [];

    if (mode === "fix") {
      tasks.push(
        {
          id: "ruff-lint-fix",
          toolId: this.id,
          capability: "lint",
          executable: "ruff",
          args: ["check", "--fix", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Ruff: lint autofix",
        },
        {
          id: "ruff-format",
          toolId: this.id,
          capability: "format",
          executable: "ruff",
          args: ["format", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Ruff: format",
        },
      );
    } else {
      tasks.push(
        {
          id: "ruff-lint-check",
          toolId: this.id,
          capability: "lint",
          executable: "ruff",
          args: ["check", "."],
          cwd: context.cwd,
          mode: "check",
          description: "Ruff: lint check",
        },
        {
          id: "ruff-format-check",
          toolId: this.id,
          capability: "format",
          executable: "ruff",
          args: ["format", "--check", "."],
          cwd: context.cwd,
          mode: "check",
          description: "Ruff: format check",
        },
      );
    }

    return tasks;
  }
}
