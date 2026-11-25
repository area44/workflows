import type { AutofixRegistry } from "@/autofix/registry";
import type {
  Capability,
  ExecutionMode,
  ExecutionTask,
  PlannedExecution,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";

import { inspectJsProjectEnvironment } from "@/javascript-env";
import { hasPythonSource } from "@/python-env";

import { processCandidateTools, processStandaloneAdapters } from "./scope-resolver";
import { formatExecutionPlanSummary } from "./summary-maker";

type ToolRecord = { id: string; name: string; reason?: string; providerId?: string };

function deduplicateTasks(tasks: ExecutionTask[]): ExecutionTask[] {
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

export class Planner {
  constructor(private readonly registry: AutofixRegistry) {}

  async plan(context: ProjectContext, mode: ExecutionMode = "fix"): Promise<PlannedExecution> {
    const resolvedHasPythonSource = context.hasPythonSource ?? hasPythonSource(context.cwd);
    const resolvedJsEnv = context.jsEnv ?? inspectJsProjectEnvironment(context.cwd);
    const effectiveContext: ProjectContext = {
      ...context,
      jsEnv: resolvedJsEnv,
      hasPythonSource: resolvedHasPythonSource,
    };

    const selectedTools: ToolRecord[] = [];
    const skippedTools: Array<{ id: string; name: string; reason: string; providerId?: string }> =
      [];
    const tasks: ExecutionTask[] = [];

    const providers = this.registry.getProviders();
    const coveredCapabilitiesByScope = new Map<string, Set<Capability>>();

    for (const provider of providers) {
      const isDetected = await provider.detect(effectiveContext);
      if (!isDetected) {
        continue;
      }

      const adapters = provider.getAdapters(effectiveContext);
      const candidateTools: {
        adapter: ToolAdapter;
        reason?: string;
        scope: string;
        providerId?: string;
      }[] = [];

      for (const adapter of adapters) {
        const result = await adapter.detect(effectiveContext);
        const scope = adapter.scope ?? provider.id;
        if (result.detected) {
          candidateTools.push({ adapter, reason: result.reason, scope, providerId: provider.id });
        } else if (result.reason && !result.reason.startsWith("no ")) {
          skippedTools.push({ id: adapter.id, name: adapter.name, reason: result.reason });
        }
      }

      await processCandidateTools(
        candidateTools,
        coveredCapabilitiesByScope,
        effectiveContext,
        mode,
        selectedTools,
        skippedTools,
        tasks,
      );
    }

    await processStandaloneAdapters(
      this.registry,
      coveredCapabilitiesByScope,
      effectiveContext,
      mode,
      selectedTools,
      skippedTools,
      tasks,
    );

    const deduplicatedTasks = deduplicateTasks(tasks);

    const summary = formatExecutionPlanSummary(
      this.registry,
      effectiveContext,
      selectedTools,
      skippedTools,
      deduplicatedTasks,
    );

    return {
      tasks: deduplicatedTasks,
      selectedTools,
      skippedTools,
      summary,
    };
  }
}

export function createPlanner(registry: AutofixRegistry): Planner {
  return new Planner(registry);
}

export { filterCandidateTasks } from "./scope-resolver";
export { processCandidateTools } from "./scope-resolver";
export { processStandaloneAdapters } from "./scope-resolver";
export { formatExecutionPlanSummary } from "./summary-maker";
export { deduplicateTasks };
