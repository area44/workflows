import type { AutofixRegistry } from "@/autofix/registry";
import type { ExecutionMode, PlannedExecution, ProjectContext } from "@/autofix/types";

import { Planner, createPlanner } from "./planner/index";

export { Planner, createPlanner };

export async function planExecution(
  registry: AutofixRegistry,
  context: ProjectContext,
  mode: ExecutionMode = "fix",
): Promise<PlannedExecution> {
  const planner = createPlanner(registry);
  return planner.plan(context, mode);
}

export { formatExecutionPlanSummary } from "./planner/index";
