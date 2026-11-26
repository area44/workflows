import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";

import { hasPythonSource } from "@/python-env";

const ruffFormatFailure = (displayCmd: string): string =>
  `Ruff command "${displayCmd}" failed. Check Python and Ruff configuration.`;

export class RuffAdapter implements ToolAdapter {
  public readonly id = "ruff";
  public readonly name = "Ruff";
  public readonly capabilities: readonly Capability[] = ["lint", "format"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    // Ruff is the default toolchain whenever Python source code is detected
    const hasSource = context.python?.hasSource ?? hasPythonSource(context.cwd);
    if (hasSource) {
      return { detected: true, reason: "default Python toolchain" };
    }
    return { detected: false, reason: "no Python source files detected" };
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
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
          resolution: "path",
          formatFailure: ruffFormatFailure,
          requiresDependencies: false,
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
          resolution: "path",
          formatFailure: ruffFormatFailure,
          requiresDependencies: false,
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
          resolution: "path",
          formatFailure: ruffFormatFailure,
          requiresDependencies: false,
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
          resolution: "path",
          formatFailure: ruffFormatFailure,
          requiresDependencies: false,
        },
      );
    }

    return tasks;
  }
}
