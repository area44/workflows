import type { Capability, ExecutionTask } from "@/autofix/types";

export function isTaskCapabilityCovered(
  taskCapability: Capability,
  coveredCapabilities: Set<Capability>,
): boolean {
  if (coveredCapabilities.has("autofix")) {
    return true;
  }
  if (taskCapability === "autofix") {
    return (
      coveredCapabilities.has("format") &&
      coveredCapabilities.has("lint") &&
      coveredCapabilities.has("assist")
    );
  }
  return coveredCapabilities.has(taskCapability);
}

export function filterCandidateTasks(
  plannedTasks: ExecutionTask[],
  providerCapabilities: Set<Capability>,
): { kept: ExecutionTask[]; skipped: ExecutionTask[] } {
  const kept: ExecutionTask[] = [];
  const skipped: ExecutionTask[] = [];

  for (const task of plannedTasks) {
    if (isTaskCapabilityCovered(task.capability, providerCapabilities)) {
      skipped.push(task);
    } else {
      kept.push(task);
    }
  }

  return { kept, skipped };
}
