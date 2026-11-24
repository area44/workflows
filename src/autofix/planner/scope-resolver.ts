import type {
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";

import { filterCandidateTasks } from "./capability-resolver";

interface CandidateTool {
  adapter: ToolAdapter;
  reason?: string;
  scope: string;
  providerId?: string;
}

type ToolRecord = { id: string; name: string; reason?: string; providerId?: string };

function getOrCreateScopeCapabilities(
  coveredCapabilitiesByScope: Map<string, Set<Capability>>,
  scope: string,
): Set<Capability> {
  let caps = coveredCapabilitiesByScope.get(scope);
  if (!caps) {
    caps = new Set<Capability>();
    coveredCapabilitiesByScope.set(scope, caps);
  }
  return caps;
}

export async function processCandidateTools(
  candidateTools: CandidateTool[],
  coveredCapabilitiesByScope: Map<string, Set<Capability>>,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: ToolRecord[],
  skippedTools: Array<{ id: string; name: string; reason: string; providerId?: string }>,
  tasks: ExecutionTask[],
): Promise<void> {
  for (const candidate of candidateTools) {
    const adapter = candidate.adapter;
    const scopeCapabilities = getOrCreateScopeCapabilities(
      coveredCapabilitiesByScope,
      candidate.scope,
    );
    const plannedTasks = await adapter.plan(context, mode);

    if (plannedTasks.length === 0) {
      continue;
    }

    const { kept, skipped } = filterCandidateTasks(plannedTasks, scopeCapabilities);

    if (kept.length === 0) {
      skippedTools.push({
        id: adapter.id,
        name: adapter.name,
        reason: "all capabilities already covered by higher priority tool",
        providerId: candidate.providerId,
      });
      continue;
    }

    selectedTools.push({
      id: adapter.id,
      name: adapter.name,
      reason: candidate.reason,
      providerId: candidate.providerId,
    });
    for (const task of kept) {
      scopeCapabilities.add(task.capability);
      if (task.capabilities) {
        for (const cap of task.capabilities) {
          scopeCapabilities.add(cap);
        }
      }
    }
    tasks.push(
      ...kept.map((task) =>
        candidate.providerId ? { ...task, providerId: candidate.providerId } : task,
      ),
    );

    if (skipped.length > 0) {
      const skippedCaps = Array.from(new Set(skipped.map((t) => t.capability))).join(", ");
      skippedTools.push({
        id: adapter.id,
        name: adapter.name,
        reason: `partially skipped (${skippedCaps} covered by higher priority tool)`,
        providerId: candidate.providerId,
      });
    }
  }
}
