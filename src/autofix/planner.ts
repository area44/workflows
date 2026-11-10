import type { AutofixRegistry } from "./registry.js";
import type {
  Capability,
  ExecutionMode,
  ExecutionTask,
  PlannedExecution,
  ProjectContext,
  ToolAdapter,
} from "./types.js";

import { inspectJsProjectEnvironment } from "../javascript-env.js";
import { hasPythonSource } from "../python-env.js";

interface CandidateTool {
  adapter: ToolAdapter;
  reason?: string;
  scope: string;
}

function isTaskCapabilityCovered(
  taskCapability: Capability,
  coveredCapabilities: Set<Capability>,
): boolean {
  // A generic full-autofix task covers all operations (format, lint, assist, etc.)
  if (coveredCapabilities.has("autofix")) {
    return true;
  }
  // A task claiming combined autofix is covered if format, lint, and assist are covered
  if (taskCapability === "autofix") {
    return (
      coveredCapabilities.has("format") &&
      coveredCapabilities.has("lint") &&
      coveredCapabilities.has("assist")
    );
  }
  // Assist is independent from format and lint
  return coveredCapabilities.has(taskCapability);
}

function filterCandidateTasks(
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

async function processCandidateTools(
  candidateTools: CandidateTool[],
  coveredCapabilitiesByScope: Map<string, Set<Capability>>,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: Array<{ id: string; name: string; reason?: string }>,
  skippedTools: Array<{ id: string; name: string; reason: string }>,
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
      });
      continue;
    }

    selectedTools.push({ id: adapter.id, name: adapter.name, reason: candidate.reason });
    for (const task of kept) {
      scopeCapabilities.add(task.capability);
      if (task.capabilities) {
        for (const cap of task.capabilities) {
          scopeCapabilities.add(cap);
        }
      }
    }
    tasks.push(...kept);

    if (skipped.length > 0) {
      const skippedCaps = Array.from(new Set(skipped.map((t) => t.capability))).join(", ");
      skippedTools.push({
        id: adapter.id,
        name: adapter.name,
        reason: `partially skipped (${skippedCaps} covered by higher priority tool)`,
      });
    }
  }
}

async function processStandaloneAdapters(
  registry: AutofixRegistry,
  coveredCapabilitiesByScope: Map<string, Set<Capability>>,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: Array<{ id: string; name: string; reason?: string }>,
  skippedTools: Array<{ id: string; name: string; reason: string }>,
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

/**
 * Resolves tool conflicts and generates a deterministic, deduplicated execution plan.
 *
 * Conflict Resolution Rules:
 * 1. Explicit scripts have top priority for JS/TS tasks.
 * 2. Treat actual planned tasks as the authoritative source of capability coverage.
 * 3. Partial capability overlap skips only overlapping tasks while retaining independent tasks.
 * 4. Deduplicate genuinely equivalent tasks deterministically.
 */
export async function planExecution(
  registry: AutofixRegistry,
  context: ProjectContext,
  mode: ExecutionMode = "fix",
): Promise<PlannedExecution> {
  // Ensure consistent Python source detection and JS project inspection across provider, adapter, and plan diagnostics
  const resolvedHasPythonSource = context.hasPythonSource ?? hasPythonSource(context.cwd);
  const resolvedJsEnv = context.jsEnv ?? inspectJsProjectEnvironment(context.cwd);
  const effectiveContext: ProjectContext = {
    ...context,
    jsEnv: resolvedJsEnv,
    hasPythonSource: resolvedHasPythonSource,
  };

  const selectedTools: Array<{ id: string; name: string; reason?: string }> = [];
  const skippedTools: Array<{ id: string; name: string; reason: string }> = [];
  const tasks: ExecutionTask[] = [];

  const providers = registry.getProviders();
  const coveredCapabilitiesByScope = new Map<string, Set<Capability>>();

  for (const provider of providers) {
    const isDetected = await provider.detect(effectiveContext);
    if (!isDetected) {
      continue;
    }

    const adapters = provider.getAdapters(effectiveContext);
    const candidateTools: CandidateTool[] = [];

    // Detect tools
    for (const adapter of adapters) {
      const result = await adapter.detect(effectiveContext);
      const scope = adapter.scope ?? provider.id;
      if (result.detected) {
        candidateTools.push({ adapter, reason: result.reason, scope });
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
    registry,
    coveredCapabilitiesByScope,
    effectiveContext,
    mode,
    selectedTools,
    skippedTools,
    tasks,
  );

  const deduplicatedTasks = deduplicateTasks(tasks);

  // Generate explainable summary using effectiveContext with consistent Python detection
  const summary = formatExecutionPlanSummary(
    registry,
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

export function formatExecutionPlanSummary(
  registry: AutofixRegistry,
  context: ProjectContext,
  selectedTools: Array<{ id: string; name: string; reason?: string }>,
  skippedTools: Array<{ id: string; name: string; reason: string }>,
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
    const pyTools = selectedTools.filter((t) => t.id === "ruff");
    if (pyTools.length > 0) {
      lines.push("  Ruff: default tool");
    } else {
      lines.push("  None");
    }
  }

  if (hasJs) {
    lines.push("");
    lines.push("JavaScript toolchain:");
    const jsSelected = selectedTools.filter((t) => t.id !== "ruff");
    for (const t of jsSelected) {
      lines.push(`  ${t.name}: selected`);
    }
    const jsSkipped = skippedTools.filter((t) => t.id !== "ruff");
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
