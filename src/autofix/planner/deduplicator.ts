import type { ExecutionTask } from "@/autofix/types";

export function deduplicateTasks(tasks: ExecutionTask[]): ExecutionTask[] {
  const deduplicatedTasks: ExecutionTask[] = [];
  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (!seenTaskIds.has(task.id)) {
      seenTaskIds.add(task.id);
      deduplicatedTasks.push(task);
    }
  }
  return deduplicatedTasks;
}
