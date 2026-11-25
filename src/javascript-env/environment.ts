import type { ResolvedJavaScriptEnvironment } from "./types";

import { resolveJsPackageManager } from "./package-manager-resolver";
import { inspectJsProjectEnvironment } from "./project-inspector";
import { resolveRuntime } from "./runtime-resolver";
import { resolveToolchain } from "./toolchain-resolver";

export function resolveJsEnvironment(
  toolchainInput?: string,
  cwd: string = process.cwd(),
): ResolvedJavaScriptEnvironment {
  const project = inspectJsProjectEnvironment(cwd);
  const pm = resolveJsPackageManager(project);
  const runtimeName = resolveRuntime(pm, project);
  const toolchain = resolveToolchain(toolchainInput, project);

  return {
    detected: project.hasPackageJson,
    runtime: {
      name: runtimeName,
    },
    packageManager: {
      name: pm.name as "npm" | "pnpm" | "bun",
    },
    toolchain,
  };
}
