import type { AutofixRegistry } from "./registry.js";
import type {
  Capability,
  ExecutionMode,
  ExecutionTask,
  PlannedExecution,
  ProjectContext,
  ToolAdapter,
} from "./types.js";

interface CandidateTool {
  adapter: ToolAdapter;
  capabilities: Capability[];
  reason?: string;
}

function checkCapabilityConflict(
  capabilities: Capability[],
  providerCapabilities: Set<Capability>,
): string | null {
  const hasAutofixCovered = providerCapabilities.has("autofix");
  const hasFormatCovered = providerCapabilities.has("format");
  const hasLintCovered = providerCapabilities.has("lint");

  if (capabilities.includes("autofix")) {
    if (hasAutofixCovered || (hasFormatCovered && hasLintCovered)) {
      return "overlapping capabilities already covered by higher priority tool";
    }
  }

  if (
    capabilities.length === 1 &&
    capabilities[0] === "format" &&
    (hasAutofixCovered || hasFormatCovered)
  ) {
    return "formatting capability already covered by higher priority tool";
  }

  if (
    capabilities.length === 1 &&
    capabilities[0] === "lint" &&
    (hasAutofixCovered || hasLintCovered)
  ) {
    return "linting capability already covered by higher priority tool";
  }

  return null;
}

async function processCandidateTools(
  candidateTools: CandidateTool[],
  providerCapabilities: Set<Capability>,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: Array<{ id: string; name: string; reason?: string }>,
  skippedTools: Array<{ id: string; name: string; reason: string }>,
  tasks: ExecutionTask[],
): Promise<void> {
  for (const candidate of candidateTools) {
    const adapter = candidate.adapter;
    const capabilities = candidate.capabilities;

    const conflictReason = checkCapabilityConflict(capabilities, providerCapabilities);
    if (conflictReason) {
      skippedTools.push({
        id: adapter.id,
        name: adapter.name,
        reason: conflictReason,
      });
      continue;
    }

    selectedTools.push({ id: adapter.id, name: adapter.name, reason: candidate.reason });
    for (const cap of capabilities) {
      providerCapabilities.add(cap);
    }

    const toolTasks = await adapter.plan(context, mode);
    tasks.push(...toolTasks);
  }
}

async function processStandaloneAdapters(
  registry: AutofixRegistry,
  context: ProjectContext,
  mode: ExecutionMode,
  selectedTools: Array<{ id: string; name: string; reason?: string }>,
  tasks: ExecutionTask[],
): Promise<void> {
  for (const adapter of registry.getStandaloneAdapters()) {
    const result = await adapter.detect(context);
    if (result.detected) {
      selectedTools.push({ id: adapter.id, name: adapter.name, reason: result.reason });
      const toolTasks = await adapter.plan(context, mode);
      tasks.push(...toolTasks);
    }
  }
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
 * 2. If a tool or script covers "autofix" (combined lint and format), standalone formatters or linters
 *    for the same language are skipped to prevent duplicate work or overwriting changes.
 * 3. Do not run multiple formatters over the same files (e.g. Biome vs Prettier vs Oxfmt).
 * 4. Do not run multiple linters over the same files (e.g. Biome vs ESLint vs Oxlint).
 * 5. Execution ordering is deterministic: lint before format for safety and consistency, or toolchain standard.
 */
export async function planExecution(
  registry: AutofixRegistry,
  context: ProjectContext,
  mode: ExecutionMode = "fix",
): Promise<PlannedExecution> {
  const selectedTools: Array<{ id: string; name: string; reason?: string }> = [];
  const skippedTools: Array<{ id: string; name: string; reason: string }> = [];
  const tasks: ExecutionTask[] = [];

  const providers = registry.getProviders();

  // Track covered capabilities per language to prevent duplicate runs
  const coveredCapabilities = new Map<string, Set<Capability>>();

  for (const provider of providers) {
    const isDetected = await provider.detect(context);
    if (!isDetected) {
      continue;
    }

    const providerCapabilities = new Set<Capability>();
    coveredCapabilities.set(provider.id, providerCapabilities);

    const adapters = provider.getAdapters(context);
    const candidateTools: CandidateTool[] = [];

    // Detect tools
    for (const adapter of adapters) {
      const result = await adapter.detect(context);
      if (result.detected) {
        const caps = adapter.getCapabilities
          ? adapter.getCapabilities(context, mode)
          : Array.from(adapter.capabilities);
        candidateTools.push({ adapter, capabilities: caps, reason: result.reason });
      } else if (result.reason && !result.reason.startsWith("no ")) {
        // Reason worth logging as skipped (e.g. dependency present without configuration)
        skippedTools.push({ id: adapter.id, name: adapter.name, reason: result.reason });
      }
    }

    await processCandidateTools(
      candidateTools,
      providerCapabilities,
      context,
      mode,
      selectedTools,
      skippedTools,
      tasks,
    );
  }

  await processStandaloneAdapters(registry, context, mode, selectedTools, tasks);

  const deduplicatedTasks = deduplicateTasks(tasks);

  // Generate explainable summary
  const summary = formatExecutionPlanSummary(
    registry,
    context,
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
