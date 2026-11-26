import * as core from "@actions/core";
import * as io from "@actions/io";

import type {
  ExecutionTask,
  LanguageProvider,
  PlannedExecution,
  ProjectContext,
} from "@/autofix/types";

import { ExecutionEngine } from "@/autofix/engine";
import { collectErrors } from "@/autofix/exec";
import { planExecution } from "@/autofix/planner/index";
import { installAndExecuteJsTasks, resolveJsPm } from "@/autofix/providers/javascript";
import { installPythonDependencies } from "@/autofix/providers/python";
import { defaultRegistry } from "@/autofix/registry";
import {
  inspectJsProjectEnvironment,
  sanitizePackageManager,
  type SupportedPackageManager,
} from "@/javascript-env";
import { hasPythonProject, hasPythonSource, type PythonPackageManagerInfo } from "@/python-env";
import { isMainModule } from "@/utils/is-main-module";

export { sanitizePackageManager };

/**
 * Builds the project context once: inspects the JavaScript environment, detects Python project
 * and source, and best-effort resolves the JavaScript package manager. All downstream planning and
 * execution reuse this context so environment inspection never runs twice.
 */
function buildProjectContext(cwd: string): ProjectContext {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  const hasSource = hasPythonSource(cwd);
  const hasProject = hasPythonProject(cwd);

  let jsPm: SupportedPackageManager | undefined;
  if (jsEnv.hasPackageJson) {
    try {
      jsPm = resolveJsPm({ cwd, javascript: { env: jsEnv }, python: { hasSource: hasSource } });
    } catch {
      // Package manager resolution failed; the JavaScript provider surfaces the error.
      jsPm = undefined;
    }
  }

  const context: ProjectContext = { cwd };
  if (jsEnv) {
    context.javascript = { env: jsEnv, packageManager: jsPm };
  }
  context.python = { hasSource: hasSource, hasProject: hasProject };
  return context;
}

function groupTasksByProvider(tasks: readonly ExecutionTask[]): Map<string, ExecutionTask[]> {
  const byProvider = new Map<string, ExecutionTask[]>();
  for (const task of tasks) {
    const key = task.providerId ?? "";
    const bucket = byProvider.get(key) ?? [];
    bucket.push(task);
    byProvider.set(key, bucket);
  }
  return byProvider;
}

/**
 * Executes a single provider's tasks.
 *
 * Providers that implement `run()` own their full lifecycle (dependency setup + execution).
 * Providers without a custom lifecycle fall back to direct engine execution of their tasks.
 */
async function runProvider(
  provider: LanguageProvider,
  context: ProjectContext,
  tasks: ExecutionTask[],
  engine: ExecutionEngine,
): Promise<Error[]> {
  if (provider.run) {
    return provider.run(context, tasks, engine);
  }
  if (tasks.length === 0) {
    return [];
  }
  return collectErrors(await engine.executeTasks(tasks));
}

export async function run(cwd: string = process.cwd()): Promise<void> {
  const context = buildProjectContext(cwd);

  // Informational: surface when the project has no JavaScript component, since the JS
  // provider's lifecycle (which previously emitted this) only runs when it is detected.
  if (!context.javascript?.env.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
  }

  // Planning is authoritative: a planning failure is a real error, not an empty plan.
  // Surface it and skip execution so we never silently run providers with no tasks.
  let overallPlan: PlannedExecution;
  try {
    overallPlan = await planExecution(defaultRegistry, context, "fix");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to plan autofix execution: ${message}`);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    return;
  }

  const tasksByProvider = groupTasksByProvider(overallPlan.tasks);
  const engine = new ExecutionEngine();
  const errors: Error[] = [];

  // Determine which providers are active for this project up front, so lifecycle hooks
  // run only for providers whose detect() returned true.
  const providersByExecutionOrder = [...defaultRegistry.getProviders()].sort(
    (a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0),
  );

  const activeProviders: LanguageProvider[] = [];
  for (const provider of providersByExecutionOrder) {
    if (await provider.detect(context)) {
      activeProviders.push(provider);
    }
  }

  for (const provider of activeProviders) {
    const providerTasks = tasksByProvider.get(provider.id) ?? [];
    errors.push(...(await runProvider(provider, context, providerTasks, engine)));
  }

  // Tasks without an owning provider (standalone adapters) execute generically after providers.
  const standaloneTasks = tasksByProvider.get("") ?? [];
  if (standaloneTasks.length > 0) {
    errors.push(...collectErrors(await engine.executeTasks(standaloneTasks)));
  }

  if (errors.length > 0) {
    const combinedMessage = errors.map((e) => e.message).join("\n");
    core.setFailed(`Failed to run scripts: ${combinedMessage}`);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
  }
}

/**
 * Standalone entry point: runs the JavaScript provider lifecycle for a single project.
 * Plans JavaScript tasks, installs dependencies, executes them, and throws on failure.
 */
export async function executeJsWorkflow(cwd: string = process.cwd()): Promise<void> {
  const jsEnv = inspectJsProjectEnvironment(cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return;
  }
  if (jsEnv.packageJsonError) {
    throw new Error(jsEnv.packageJsonError);
  }

  let jsPm: SupportedPackageManager | undefined;
  if (jsEnv.hasPackageJson) {
    try {
      jsPm = resolveJsPm({ cwd, javascript: { env: jsEnv }, python: { hasSource: false } });
    } catch {
      // Package manager resolution failed; installAndExecuteJsTasks re-resolves and surfaces the error.
      jsPm = undefined;
    }
  }

  const context: ProjectContext = {
    cwd,
    javascript: { env: jsEnv, packageManager: jsPm },
    python: { hasSource: false },
  };
  const plan = await planExecution(defaultRegistry, context, "fix");
  // JavaScript-owned tasks only; other providers' tasks are not routed through the JS lifecycle.
  const jsTasks = plan.tasks.filter((t) => t.providerId === "javascript");

  if (jsTasks.length === 0) {
    core.info("No matching scripts (fix, format, lint, check, etc.) found in package.json.");
    return;
  }

  const engine = new ExecutionEngine();
  const errors = await installAndExecuteJsTasks(context, jsTasks, engine);
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("\n"));
  }
}

/**
 * Standalone entry point: installs Python dependencies for the given package manager.
 */
export async function executePythonWorkflow(
  pmInfo: PythonPackageManagerInfo,
  cwd: string = process.cwd(),
): Promise<void> {
  await installPythonDependencies(pmInfo, cwd);
}

/**
 * Standalone entry point: runs Ruff lint/format autofix for a Python project.
 *
 * `hasSource` may be supplied by callers that already detected Python source (avoids a
 * duplicate scan). `preplannedTasks` may be supplied to skip re-planning.
 */
export async function executeRuffAutofix(
  cwd: string = process.cwd(),
  hasSource?: boolean,
  preplannedTasks?: ExecutionTask[],
): Promise<void> {
  const hasSourceCode = hasSource ?? hasPythonSource(cwd);
  if (!hasSourceCode) {
    return;
  }

  let tasks: ExecutionTask[];
  if (preplannedTasks) {
    tasks = preplannedTasks;
  } else {
    const hasRuff = Boolean(await io.which("ruff", false));
    if (!hasRuff) {
      throw new Error("Required Python binary 'ruff' is not available in PATH.");
    }
    const context: ProjectContext = { cwd, python: { hasSource: true } };
    const ruffPlan = await planExecution(defaultRegistry, context, "fix");
    tasks = ruffPlan.tasks.filter((t) => t.providerId === "python");
  }

  const engine = new ExecutionEngine();
  const results = await engine.executeTasks(tasks);
  const failures = collectErrors(results);
  if (failures.length > 0) {
    throw new Error(failures.map((e) => e.message).join("\n"));
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  void run();
}
