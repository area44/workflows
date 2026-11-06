import * as core from "@actions/core";
import * as exec from "@actions/exec";

import type { ExecutionTask } from "./types.js";

export interface ExecutionResult {
  task: ExecutionTask;
  exitCode: number;
  error?: Error;
}

export class ExecutionEngine {
  /**
   * Executes tasks sequentially, capturing diagnostics and aggregating any task errors.
   */
  public async executeTasks(tasks: ExecutionTask[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const task of tasks) {
      const displayCmd = `${task.executable} ${task.args.join(" ")}`.trim();
      core.info(`Executing: ${displayCmd}`);

      try {
        const env = task.env
          ? (Object.fromEntries(
              Object.entries({ ...process.env, ...task.env }).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ) as Record<string, string>)
          : undefined;

        const exitCode = await exec.exec(task.executable, task.args, {
          cwd: task.cwd,
          env,
          ignoreReturnCode: true,
        });

        if (exitCode !== 0) {
          const errMessage =
            task.toolId === "ruff"
              ? `Ruff command "${displayCmd}" failed. Check Python and Ruff configuration.`
              : task.toolId === "npm-scripts"
                ? `Script "${task.args[1] || displayCmd}" failed while executing "${displayCmd}".`
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
