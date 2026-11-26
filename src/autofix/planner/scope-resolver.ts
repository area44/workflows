import type { AutofixRegistry } from "@/autofix/registry";
import type {
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";

interface CandidateTool {
  adapter: ToolAdapter;
  reason?: string;
  scope: string;
  providerId?: string;
}

type ToolRecord = { id: string; name: string; reason?: string; providerId?: string };

function isTaskCapabilityCovered(
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

export async function processStandaloneAdapters(
  registry: AutofixRegistry,
  coveredCapabilitiesByScope: Map<string, Set<Capability>>,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: ToolRecord[],
  skippedTools: Array<{ id: string; name: string; reason: string; providerId?: string }>,
  tasks: ExecutionTask[],
): Promise<void> {
  const candidateTools: CandidateTool[] = [];
  for (const adapter of registry.getStandaloneAdapters()) {
    const result = await adapter.detect(context);
    const scope = adapter.scope ?? `standalone:${adapter.id}`;
    if (result.detected) {
      candidateTools.push({ adapter, reason: result.reason, scope });
    } else if (result.reason && !result.reason.startsWith("no ")) {
      skippedTools.push({ id: adapter.id, name: adapter.name, reason: result.reason });
    }
  }

  await processCandidateTools(
    candidateTools,
    coveredCapabilitiesByScope,
    context,
    mode,
    selectedTools,
    skippedTools,
    tasks,
  );
}
