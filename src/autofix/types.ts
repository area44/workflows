import type { JsProjectEnvironment, SupportedPackageManager } from "../javascript-env.js";
import type { PythonPackageManagerInfo, PythonProjectContext } from "../python-env.js";

export type Capability = "lint" | "format" | "typecheck" | "autofix";

export type ExecutionMode = "fix" | "check";

export interface ExecutionTask {
  id: string;
  toolId: string;
  capability: Capability;
  executable: string;
  args: string[];
  cwd: string;
  mode: ExecutionMode;
  env?: Record<string, string>;
  description?: string;
}

export interface ProjectContext {
  cwd: string;
  jsEnv?: JsProjectEnvironment;
  jsPm?: SupportedPackageManager;
  pyCtx?: PythonProjectContext;
  pyPmInfo?: PythonPackageManagerInfo | null;
  hasPythonSource?: boolean;
}

export interface AdapterDetectionResult {
  detected: boolean;
  reason?: string;
}

export interface ToolAdapter {
  id: string;
  name: string;
  capabilities: Capability[];

  detect(context: ProjectContext): Promise<AdapterDetectionResult> | AdapterDetectionResult;

  plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> | ExecutionTask[];
}

export interface LanguageProvider {
  id: string;
  name: string;

  detect(context: ProjectContext): Promise<boolean> | boolean;

  getAdapters(context: ProjectContext): ToolAdapter[];
}

export interface PlannedExecution {
  tasks: ExecutionTask[];
  selectedTools: Array<{ id: string; name: string; reason?: string }>;
  skippedTools: Array<{ id: string; name: string; reason: string }>;
  summary: string;
}
