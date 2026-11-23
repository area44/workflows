import * as core from "@actions/core";

import type { ExecutionEngine } from "../engine.js";
import type { ExecutionTask, LanguageProvider, ProjectContext, ToolAdapter } from "../types.js";

import {
  getJsInstallationPlan,
  inspectJsProjectEnvironment,
  resolveJsPackageManager,
  sanitizePackageManager,
  type SupportedPackageManager,
} from "../../javascript-env.js";
import { JavaScriptScriptAdapter } from "../adapters/javascript/script-adapter.js";
import {
  BiomeAdapter,
  EslintAdapter,
  OxfmtAdapter,
  OxlintAdapter,
  PrettierAdapter,
  VitePlusAdapter,
} from "../adapters/javascript/tools.js";
import { collectErrors, formatCommand, runLoggedCommand } from "../exec.js";

const JS_SETUP_OUTCOME_VARS = [
  "JS_SETUP_OUTCOME",
  "NODE_SETUP_OUTCOME",
  "BUN_SETUP_OUTCOME",
  "PNPM_SETUP_OUTCOME",
] as const;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function anySetupFailed(vars: readonly string[]): boolean {
  return vars.some((name) => process.env[name] === "failure");
}

/**
 * Resolves the JavaScript package manager, throwing an actionable error when resolution fails.
 */
export function resolveJsPm(context: ProjectContext): SupportedPackageManager {
  const rawPm = process.env.PACKAGE_MANAGER || resolveJsPackageManager(context.jsEnv!).name;
  return sanitizePackageManager(rawPm) as SupportedPackageManager;
}

/**
 * Installs JavaScript dependencies using the resolved package manager's install plan.
 * Logs the actual command before running it and surfaces an actionable error on failure.
 */
async function installJsDependencies(cwd: string, pm: SupportedPackageManager): Promise<void> {
  const plan = getJsInstallationPlan(pm);
  const exitCode = await runLoggedCommand(plan.command, plan.args, cwd);
  if (exitCode !== 0) {
    const displayCmd = formatCommand(plan.command, plan.args);
    throw new Error(
      `JS dependency installation failed executing "${displayCmd}". Check dependency constraints or lockfile compatibility.`,
    );
  }
}

/**
 * Installs JavaScript dependencies then executes the given tasks.
 * Returns aggregated errors (empty on success). Does not gate on setup outcomes.
 */
export async function installAndExecuteJsTasks(
  context: ProjectContext,
  tasks: ExecutionTask[],
  engine: ExecutionEngine,
): Promise<Error[]> {
  try {
    const pm = resolveJsPm(context);
    await installJsDependencies(context.cwd, pm);
  } catch (error) {
    return [toError(error)];
  }

  const results = await engine.executeTasks(tasks);
  return collectErrors(results);
}

/**
 * JavaScript provider lifecycle: gates on JS setup outcomes, installs dependencies,
 * and executes the provider's tasks. Returns aggregated errors (empty on success).
 */
async function runJsProvider(
  context: ProjectContext,
  tasks: ExecutionTask[],
  engine: ExecutionEngine,
): Promise<Error[]> {
  if (anySetupFailed(JS_SETUP_OUTCOME_VARS)) {
    return [new Error("JavaScript runtime or package manager setup failed.")];
  }

  const jsEnv = context.jsEnv ?? inspectJsProjectEnvironment(context.cwd);
  if (!jsEnv.hasPackageJson) {
    core.info("No package.json found. Skipping scripts.");
    return [];
  }
  if (jsEnv.packageJsonError) {
    return [new Error(jsEnv.packageJsonError)];
  }

  if (tasks.length === 0) {
    core.info("No matching scripts (fix, format, lint, check, etc.) found in package.json.");
    return [];
  }

  return installAndExecuteJsTasks({ ...context, jsEnv }, tasks, engine);
}

export class JavaScriptLanguageProvider implements LanguageProvider {
  public readonly id = "javascript";
  public readonly name = "JavaScript/TypeScript";
  public readonly executionOrder = 0;

  private scriptAdapter = new JavaScriptScriptAdapter();
  private vitePlusAdapter = new VitePlusAdapter();
  private biomeAdapter = new BiomeAdapter();
  private prettierAdapter = new PrettierAdapter();
  private eslintAdapter = new EslintAdapter();
  private oxlintAdapter = new OxlintAdapter();
  private oxfmtAdapter = new OxfmtAdapter();

  public detect(context: ProjectContext): boolean {
    return Boolean(context.jsEnv?.hasPackageJson);
  }

  public getAdapters(_context: ProjectContext): ToolAdapter[] {
    // Return all candidate adapters in precedence order:
    // 1. Explicit scripts
    // 2. Vite+ (project-native toolchain)
    // 3. Biome (unified tool)
    // 4. Prettier / ESLint / Oxlint / Oxfmt (specialized tools)
    return [
      this.scriptAdapter,
      this.vitePlusAdapter,
      this.biomeAdapter,
      this.oxfmtAdapter,
      this.prettierAdapter,
      this.oxlintAdapter,
      this.eslintAdapter,
    ];
  }

  public run(
    context: ProjectContext,
    tasks: ExecutionTask[],
    engine: ExecutionEngine,
  ): Promise<Error[]> {
    return runJsProvider(context, tasks, engine);
  }
}
