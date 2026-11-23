import type { ResolvedJavaScriptEnvironment } from "@/javascript-env/types";

import { inspectJsProjectEnvironment } from "@/javascript-env/inspect";
import { resolveJsPackageManager } from "@/javascript-env/package-manager";
import { resolveRuntime } from "@/javascript-env/runtime";
import { resolveToolchain } from "@/javascript-env/toolchain";

export * from "@/javascript-env/types";
export * from "@/javascript-env/runtime";
export * from "@/javascript-env/dev-engines";
export * from "@/javascript-env/toolchain";
export * from "@/javascript-env/inspect";
export * from "@/javascript-env/package-manager";
export * from "@/javascript-env/sanitize";
export * from "@/javascript-env/install";

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
      name: pm.name,
    },
    toolchain,
  };
}
