import type { ExecutionEngine } from "@/autofix/engine";
import type { JsProjectEnvironment, SupportedPackageManager } from "@/javascript-env";
import type { PythonPackageManagerInfo } from "@/python-env";
import type { PythonProjectContext as PythonProjectInspection } from "@/python-env";

export type Capability = "lint" | "format" | "typecheck" | "assist" | "autofix";

export type ExecutionMode = "fix" | "check";

/**
 * Controls how the execution engine resolves a task's executable and reports failures.
 *
 * - `passthrough`  Use `executable` as-is (e.g. `npm`, `pnpm`, `bun`). No lookup.
 * - `path`         Confirm `executable` is on PATH via `io.which`, then invoke it by name.
 * - `project-binary` Resolve `executable` from `node_modules/.bin` (or PATH as a fallback).
 */
export type ExecutableResolution = "passthrough" | "path" | "project-binary";

export interface ExecutionTask {
  id: string;
  toolId: string;
  /**
   * Owning provider id. Assigned centrally by the planner so the orchestrator can route tasks
   * by execution domain instead of inspecting individual tool ids.
   */
  providerId?: string;
  capability: Capability;
  capabilities?: readonly Capability[];
  executable: string;
  args: string[];
  cwd: string;
  mode: ExecutionMode;
  env?: Record<string, string>;
  description?: string;
  toolName?: string;
  requiredPackage?: string;
  /**
   * Executable resolution strategy. Defaults to `project-binary` when omitted.
   */
  resolution?: ExecutableResolution;
  /**
   * Optional custom error message formatter for non-zero exit codes.
   * Receives the display command and exit code; returns the message to surface.
   */
  formatFailure?: (displayCmd: string, exitCode: number) => string;
}

export interface JavaScriptProjectContext {
  env: JsProjectEnvironment;
  packageManager?: SupportedPackageManager;
}

export interface PythonProjectContextSummary {
  hasSource: boolean;
  hasProject?: boolean;
  inspection?: PythonProjectInspection;
  packageManager?: PythonPackageManagerInfo | null;
}

export interface ProjectContext {
  cwd: string;
  javascript?: JavaScriptProjectContext;
  python?: PythonProjectContextSummary;
}

export interface AdapterDetectionResult {
  detected: boolean;
  reason?: string;
  hasConfig?: boolean;
  hasDependency?: boolean;
  isExecutableAvailable?: boolean;
  isEligible?: boolean;
}

export interface ToolAdapter {
  id: string;
  name: string;
  capabilities: readonly Capability[];
  /**
   * Conflict domain scope for capability deduplication and conflict resolution.
   * - For provider adapters, defaults to `provider.id` (e.g. "javascript", "python").
   * - For standalone adapters, can explicitly match a provider id (e.g. "javascript")
   *   or another shared scope name to resolve genuine conflicts within that domain.
   *   When omitted, defaults to an isolated per-adapter scope (`standalone:${id}`).
   */
  scope?: string;

  detect(context: ProjectContext): Promise<AdapterDetectionResult> | AdapterDetectionResult;

  plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> | ExecutionTask[];
}

export interface LanguageProvider {
  id: string;
  name: string;

  /**
   * Execution order priority (ascending). Providers with a lower value run first during `run()`.
   * This is intentionally decoupled from registration order, which drives the plan/task order.
   * Defaults to 0 when omitted.
   */
  executionOrder?: number;

  detect(context: ProjectContext): Promise<boolean> | boolean;

  getAdapters(context: ProjectContext): ToolAdapter[];

  /**
   * Optional provider-owned setup and execution lifecycle.
   *
   * When implemented, the orchestrator delegates the provider's tasks (already filtered by
   * `providerId`) to this method instead of running them through the generic engine path.
   * Providers use this to install dependencies, apply setup-outcome gating, and execute tasks
   * with any domain-specific semantics — without the central orchestrator needing to know
   * about individual languages.
   *
   * Implementations receive the fully resolved project context, the tasks owned by this
   * provider, and the shared execution engine. They return aggregated errors (empty when all
   * tasks succeeded).
   */
  run?(context: ProjectContext, tasks: ExecutionTask[], engine: ExecutionEngine): Promise<Error[]>;
}

export interface PlannedExecution {
  tasks: ExecutionTask[];
  selectedTools: Array<{ id: string; name: string; reason?: string; providerId?: string }>;
  skippedTools: Array<{ id: string; name: string; reason: string; providerId?: string }>;
  summary: string;
}
