import * as io from "@actions/io";

import type { ExecutionEngine } from "../engine.js";
import type { ExecutionTask, LanguageProvider, ProjectContext, ToolAdapter } from "../types.js";

import {
  detectPythonPackageManager,
  hasPythonSource,
  validatePythonPmInfoStructure,
  type PythonPackageManagerInfo,
} from "../../python-env.js";
import { RuffAdapter } from "../adapters/python/ruff.js";
import { collectErrors, formatCommand, runLoggedCommand } from "../exec.js";

const PYTHON_SETUP_OUTCOME_VARS = [
  "PYTHON_SETUP_OUTCOME",
  "UV_SETUP_OUTCOME",
  "PY_SETUP_OUTCOME",
] as const;

const RUFF_SETUP_OUTCOME_VAR = "RUFF_SETUP_OUTCOME";

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function anySetupFailed(vars: readonly string[]): boolean {
  return vars.some((name) => process.env[name] === "failure");
}

/**
 * Runs a Python install command, resolving the executable on PATH before logging. If the
 * executable is unavailable, throws without emitting an `Executing:` line. Surfaces an
 * actionable error on non-zero exit.
 */
async function runPythonInstallCommand(
  executable: string,
  args: string[],
  cwd: string,
): Promise<void> {
  const exitCode = await runLoggedCommand(executable, args, cwd, async () => {
    const resolved = await io.which(executable, false);
    if (!resolved) {
      throw new Error(`Required executable '${executable}' is not available in PATH.`);
    }
    // Validate availability, but invoke via the logical name to preserve existing behavior.
    return executable;
  });
  if (exitCode !== 0) {
    const displayCmd = formatCommand(executable, args);
    throw new Error(
      `Python command "${displayCmd}" failed. Check Python environment and dependency configuration.`,
    );
  }
}

/**
 * Installs Python dependencies described by `pmInfo` (uv/pip). Standalone managers with no
 * install commands are treated as a no-op. Logs every command before running it.
 */
export async function installPythonDependencies(
  pmInfo: PythonPackageManagerInfo,
  cwd: string,
): Promise<void> {
  validatePythonPmInfoStructure(pmInfo, 'Invalid Python environment: "pmInfo" must be an object');

  const requiredBin = pmInfo.name === "pip" ? "pip" : pmInfo.name;
  const hasPmBin = Boolean(await io.which(requiredBin, false));

  if (!hasPmBin && !pmInfo.isStandalone) {
    throw new Error(`Required Python package manager '${requiredBin}' is not available in PATH.`);
  }

  if (pmInfo.isStandalone || pmInfo.installCommands.length === 0) {
    return;
  }

  for (const { executable, args } of pmInfo.installCommands) {
    await runPythonInstallCommand(executable, args, cwd);
  }
}

/**
 * Python provider lifecycle: installs Python dependencies (gated on Python setup outcomes)
 * and executes Ruff tasks (gated on the Ruff setup outcome) as independent steps.
 */
async function runPythonProvider(
  context: ProjectContext,
  tasks: ExecutionTask[],
  engine: ExecutionEngine,
): Promise<Error[]> {
  const hasSourceCode = context.hasPythonSource ?? hasPythonSource(context.cwd);
  if (!hasSourceCode) {
    return [];
  }

  const errors: Error[] = [];

  if (!anySetupFailed(PYTHON_SETUP_OUTCOME_VARS)) {
    const pmInfo = detectPythonPackageManager(context.cwd, undefined, {
      hasSource: true,
      isProject: true,
    });
    if (pmInfo) {
      try {
        await installPythonDependencies(pmInfo, context.cwd);
      } catch (error) {
        errors.push(toError(error));
      }
    }
  } else {
    errors.push(new Error("Python runtime or package manager setup failed."));
  }

  if (process.env[RUFF_SETUP_OUTCOME_VAR] === "failure") {
    errors.push(new Error("Ruff setup failed."));
    return errors;
  }

  if (tasks.length > 0) {
    errors.push(...collectErrors(await engine.executeTasks(tasks)));
  }

  return errors;
}

export class PythonLanguageProvider implements LanguageProvider {
  public readonly id = "python";
  public readonly name = "Python";
  public readonly executionOrder = 1;

  private ruffAdapter = new RuffAdapter();

  public detect(context: ProjectContext): boolean {
    return context.hasPythonSource ?? hasPythonSource(context.cwd);
  }

  public getAdapters(_context: ProjectContext): ToolAdapter[] {
    return [this.ruffAdapter];
  }

  public run(
    context: ProjectContext,
    tasks: ExecutionTask[],
    engine: ExecutionEngine,
  ): Promise<Error[]> {
    return runPythonProvider(context, tasks, engine);
  }
}
