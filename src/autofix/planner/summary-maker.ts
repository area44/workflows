import type { AutofixRegistry } from "@/autofix/registry";
import type { ProjectContext, ExecutionTask } from "@/autofix/types";

type ToolRecord = { id: string; name: string; reason?: string; providerId?: string };

export function formatExecutionPlanSummary(
  registry: AutofixRegistry,
  context: ProjectContext,
  selectedTools: ToolRecord[],
  skippedTools: Array<{ id: string; name: string; reason: string; providerId?: string }>,
  tasks: ExecutionTask[],
): string {
  const lines: string[] = [];

  lines.push("Detected environments:");
  const hasPy = context.hasPythonSource ?? false;
  const hasJs = context.jsEnv?.hasPackageJson ?? false;
  lines.push(`  Python: ${hasPy}`);
  lines.push(`  JavaScript: ${hasJs}`);

  if (hasPy) {
    lines.push("");
    lines.push("Python toolchain:");
    const pyTools = selectedTools.filter((t) => t.providerId === "python");
    if (pyTools.length > 0) {
      for (const t of pyTools) {
        lines.push(`  ${t.name}: default tool`);
      }
    } else {
      lines.push("  None");
    }
  }

  if (hasJs) {
    lines.push("");
    lines.push("JavaScript toolchain:");
    const jsSelected = selectedTools.filter((t) => t.providerId !== "python");
    for (const t of jsSelected) {
      lines.push(`  ${t.name}: selected`);
    }
    const jsSkipped = skippedTools.filter((t) => t.providerId !== "python");
    for (const t of jsSkipped) {
      lines.push(`  ${t.name}: skipped (${t.reason})`);
    }
  }

  lines.push("");
  lines.push("Execution plan:");
  if (tasks.length === 0) {
    lines.push("  (no tasks to execute)");
  } else {
    tasks.forEach((task, idx) => {
      const desc = task.description || `${task.executable} ${task.args.join(" ")}`;
      lines.push(`  ${idx + 1}. ${desc}`);
    });
  }

  if (skippedTools.length > 0) {
    lines.push("");
    lines.push("Skipped:");
    for (const t of skippedTools) {
      lines.push(`  - ${t.name}: ${t.reason}`);
    }
  }

  return lines.join("\n");
}
