import * as io from "@actions/io";

import type { ExecutableResolution, ExecutionTask } from "@/autofix/types";

import { formatCommand, runLoggedCommand } from "@/autofix/exec";
import { resolveProjectBinary } from "@/autofix/executable-resolver";

export interface ExecutionResult {
  task: ExecutionTask;
  exitCode: number;
  error?: Error;
}

export class ExecutionEngine {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /**
   * Resolves the executable path for a task at execution time (after dependencies are provisioned).
   *
   * Resolution is driven by `task.resolution` (defaults to `project-binary`) rather than by
   * inspecting specific tool ids, so adding a new adapter never requires engine changes.
   */
  public async resolveTaskExecutable(task: ExecutionTask): Promise<string> {
    const resolution: ExecutableResolution = task.resolution ?? "project-binary";

    if (resolution === "passthrough") {
      return task.executable;
    }

    if (resolution === "path") {
      const hasBin = Boolean(await io.which(task.executable, false));
      if (!hasBin) {
        throw new Error(`Required binary '${task.executable}' is not available in PATH.`);
      }
      return task.executable;
    }

    // project-binary: resolve from node_modules/.bin or PATH
    const resolved = await resolveProjectBinary(task.cwd, task.executable, this.platform);
    if (!resolved) {
      const toolName = task.toolName || task.toolId;
      const depName = task.requiredPackage || task.executable;
      throw new Error(
        `Configured tool "${toolName}" could not run: executable "${task.executable}" is not available in node_modules/.bin or PATH. Please install "${depName}" in project dependencies.`,
      );
    }
    return resolved;
  }

  /**
   * Executes tasks sequentially, capturing diagnostics and aggregating any task errors.
   */
  public async executeTasks(tasks: ExecutionTask[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const task of tasks) {
      try {
        const displayCmd = formatCommand(task.executable, task.args);

        const env = task.env
          ? (Object.fromEntries(
              Object.entries({ ...process.env, ...task.env }).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ) as Record<string, string>)
          : undefined;

        // Resolve first (inside runLoggedCommand); if resolution fails, no Executing: line is emitted.
        const exitCode = await runLoggedCommand(
          task.executable,
          task.args,
          task.cwd,
          () => this.resolveTaskExecutable(task),
          { env },
        );

        if (exitCode !== 0) {
          const errMessage = task.formatFailure
            ? task.formatFailure(displayCmd, exitCode)
            : `Task "${task.id}" (${displayCmd}) failed with exit code ${exitCode}.`;
          results.push({
            task,
            exitCode,
            error: new Error(errMessage),
          });
        } else {
          results.push({ task, exitCode });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results.push({
          task,
          exitCode: 1,
          error,
        });
      }
    }

    return results;
  }
}
