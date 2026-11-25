import fs from "node:fs";
import path from "node:path";

import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "@/autofix/types";
import type { JsPackageManifest } from "@/javascript-env";

import { resolveProjectBinary } from "@/autofix/executable-resolver";

function hasDependency(pkg: JsPackageManifest | undefined, depName: string): boolean {
  if (!pkg) return false;
  return Boolean(
    pkg.dependencies?.[depName] ||
    pkg.devDependencies?.[depName] ||
    pkg.peerDependencies?.[depName] ||
    pkg.optionalDependencies?.[depName],
  );
}

function hasAnyConfigFile(cwd: string, filenames: string[]): boolean {
  for (const f of filenames) {
    if (fs.existsSync(path.join(cwd, f))) {
      return true;
    }
  }
  return false;
}

export interface DetectToolOptions {
  toolId: string;
  toolName: string;
  executable: string;
  requiredPackage: string;
  hasConfig: boolean;
  extraPackages?: string[];
  platform?: NodeJS.Platform;
}

export async function detectToolAvailability(
  context: ProjectContext,
  options: DetectToolOptions,
): Promise<AdapterDetectionResult> {
  const { toolName, executable, requiredPackage, hasConfig, extraPackages, platform } = options;
  const pkg = context.javascript?.env.packageJson;
  const packagesToCheck = [requiredPackage, ...(extraPackages ?? [])];
  const hasDep = packagesToCheck.some((dep) => hasDependency(pkg, dep));

  if (!hasConfig) {
    if (hasDep) {
      const suffix = toolName === "Biome" ? " file" : "";
      return {
        detected: false,
        reason: `${toolName} dependency present without configuration${suffix}`,
        hasConfig: false,
        hasDependency: true,
        isExecutableAvailable: false,
        isEligible: false,
      };
    }
    return {
      detected: false,
      reason: `no ${toolName} dependency or configuration`,
      hasConfig: false,
      hasDependency: false,
      isExecutableAvailable: false,
      isEligible: false,
    };
  }

  const resolvedBin = await resolveProjectBinary(context.cwd, executable, platform);
  const hasExec = Boolean(resolvedBin);

  if (hasDep) {
    return {
      detected: true,
      reason: `${toolName} dependency and configuration detected`,
      hasConfig: true,
      hasDependency: true,
      isExecutableAvailable: hasExec,
      isEligible: true,
    };
  }

  if (hasExec) {
    return {
      detected: true,
      reason: `${toolName} configuration detected and executable available`,
      hasConfig: true,
      hasDependency: false,
      isExecutableAvailable: true,
      isEligible: true,
    };
  }

  return {
    detected: false,
    reason: `${toolName} configuration detected but executable is unavailable and dependency is not declared`,
    hasConfig: true,
    hasDependency: false,
    isExecutableAvailable: false,
    isEligible: false,
  };
}

export interface TaskDefinition {
  id: string;
  capability: Capability;
  executable: string;
  args: string[];
  description: string;
}

export interface AdapterConfig {
  id: string;
  name: string;
  capabilities: readonly Capability[];
  executable: string;
  requiredPackage: string;
  extraPackages?: string[];
  configFiles: string[];
  pkgConfigKeys?: string[];
  fixTasks: TaskDefinition[];
  checkTasks: TaskDefinition[];
  customDetect?: (
    context: ProjectContext,
  ) => Promise<AdapterDetectionResult> | AdapterDetectionResult;
  customPlan?: (context: ProjectContext, mode: ExecutionMode) => Promise<ExecutionTask[]>;
}

export abstract class BaseToolAdapter implements ToolAdapter {
  public readonly id: string;
  public readonly name: string;
  public readonly capabilities: readonly Capability[];
  protected readonly config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.config = config;
  }

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    if (this.config.customDetect) {
      return this.config.customDetect(context);
    }

    const hasPkgConfig = this.config.pkgConfigKeys?.some((key) =>
      Boolean((context.javascript?.env.packageJson as any)?.[key]),
    );
    const hasConfigFile = hasAnyConfigFile(context.cwd, this.config.configFiles);
    const hasConfig = Boolean(hasPkgConfig || hasConfigFile);

    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: this.config.executable,
      requiredPackage: this.config.requiredPackage,
      extraPackages: this.config.extraPackages,
      hasConfig,
    });
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    if (this.config.customPlan) {
      return this.config.customPlan(context, mode);
    }

    const tasks = mode === "fix" ? this.config.fixTasks : this.config.checkTasks;

    return tasks.map((task) => ({
      id: task.id,
      toolId: this.id,
      toolName: this.name,
      requiredPackage: this.config.requiredPackage,
      capability: task.capability,
      executable: task.executable,
      args: task.args,
      cwd: context.cwd,
      mode,
      description: task.description,
    }));
  }
}
