import fs from "node:fs";
import path from "node:path";

import type {
  AdapterDetectionResult,
  Capability,
  ExecutionMode,
  ExecutionTask,
  ProjectContext,
  ToolAdapter,
} from "../../types.js";

import { hasVitePlusDependency, type JsPackageManifest } from "../../../javascript-env.js";
import { resolveProjectBinary } from "../../engine.js";
import { hasVitePlusCommand } from "./script-adapter.js";

function hasVitePlusScript(scripts?: Record<string, string>): boolean {
  if (!scripts) return false;
  return Object.values(scripts).some((scriptBody) => {
    return hasVitePlusCommand(scriptBody, scripts);
  });
}

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

/**
 * Shared detection and executable availability resolution abstraction.
 * Distinguishes between:
 * - Configuration discovered (hasConfig)
 * - Dependency declared (hasDependency)
 * - Executable available (isExecutableAvailable)
 * - Tool eligible for execution (isEligible / detected)
 */
export async function detectToolAvailability(
  context: ProjectContext,
  options: DetectToolOptions,
): Promise<AdapterDetectionResult> {
  const { toolName, executable, requiredPackage, hasConfig, extraPackages, platform } = options;
  const pkg = context.jsEnv?.packageJson;
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

  // Configuration was discovered.
  // Check if executable is already available on the system or locally in node_modules/.bin
  const resolvedBin = await resolveProjectBinary(context.cwd, executable, platform);
  const hasExec = Boolean(resolvedBin);

  // If dependency is declared in project manifest:
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

  // Dependency is absent, but executable is available (e.g. global binary in PATH or pre-installed local binary)
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

  // Configuration discovered, but dependency is absent and executable is unavailable
  return {
    detected: false,
    reason: `${toolName} configuration detected but executable is unavailable and dependency is not declared`,
    hasConfig: true,
    hasDependency: false,
    isExecutableAvailable: false,
    isEligible: false,
  };
}

// Vite+ Adapter
export class VitePlusAdapter implements ToolAdapter {
  public readonly id = "vite-plus";
  public readonly name = "Vite+";
  public readonly capabilities: readonly Capability[] = ["autofix", "format", "lint"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasVitePlusDependency(pkg);
    const hasConfig = hasAnyConfigFile(context.cwd, [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.cjs",
    ]);

    const hasVpScript = hasVitePlusScript(pkg?.scripts);
    const resolvedBin = await resolveProjectBinary(context.cwd, "vp");
    const hasExec = Boolean(resolvedBin);

    // 1. Dependency declared: eligible via package provisioning lifecycle
    if (hasDep) {
      return {
        detected: true,
        reason: "Vite+ dependency and/or configuration detected",
        hasConfig,
        hasDependency: true,
        isExecutableAvailable: hasExec,
        isEligible: true,
      };
    }

    // 2. Dependency not declared, but Vite config and vp script exist:
    // Requires confirmed executable availability (e.g. global vp in PATH or pre-installed local binary).
    // Mere script detection or package runner (npx/bunx/pnpm exec) without a resolved executable is not eligible.
    if (hasConfig && hasVpScript) {
      if (hasExec) {
        return {
          detected: true,
          reason: "Vite+ configuration detected and executable available",
          hasConfig: true,
          hasDependency: false,
          isExecutableAvailable: true,
          isEligible: true,
        };
      }
      return {
        detected: false,
        reason:
          "Vite+ script detected but executable is unavailable and dependency is not declared",
        hasConfig: true,
        hasDependency: false,
        isExecutableAvailable: false,
        isEligible: false,
      };
    }

    return {
      detected: false,
      reason: "no Vite+ dependency or configuration",
      hasConfig,
      hasDependency: false,
      isExecutableAvailable: false,
      isEligible: false,
    };
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "vite-plus-fmt",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "vite-plus",
          capability: "format",
          executable: "vp",
          args: ["fmt"],
          cwd: context.cwd,
          mode: "fix",
          description: "Vite+: vp fmt",
        },
        {
          id: "vite-plus-lint-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "vite-plus",
          capability: "lint",
          executable: "vp",
          args: ["lint", "--fix"],
          cwd: context.cwd,
          mode: "fix",
          description: "Vite+: vp lint --fix",
        },
      ];
    }

    return [
      {
        id: "vite-plus-fmt-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "vite-plus",
        capability: "format",
        executable: "vp",
        args: ["fmt", "--check"],
        cwd: context.cwd,
        mode: "check",
        description: "Vite+: vp fmt --check",
      },
      {
        id: "vite-plus-lint",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "vite-plus",
        capability: "lint",
        executable: "vp",
        args: ["lint"],
        cwd: context.cwd,
        mode: "check",
        description: "Vite+: vp lint",
      },
    ];
  }
}

// Biome Adapter
export class BiomeAdapter implements ToolAdapter {
  public readonly id = "biome";
  public readonly name = "Biome";
  public readonly capabilities: readonly Capability[] = ["format", "lint", "assist"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const hasConfig = hasAnyConfigFile(context.cwd, ["biome.json", "biome.jsonc"]);
    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: "biome",
      requiredPackage: "@biomejs/biome",
      extraPackages: ["biome"],
      hasConfig,
    });
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "biome-format-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "@biomejs/biome",
          capability: "format",
          executable: "biome",
          args: ["format", "--write", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Biome: format --write .",
        },
        {
          id: "biome-lint-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "@biomejs/biome",
          capability: "lint",
          executable: "biome",
          args: ["lint", "--write", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Biome: lint --write .",
        },
        {
          id: "biome-assist-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "@biomejs/biome",
          capability: "assist",
          executable: "biome",
          args: ["check", "--write", "--formatter-enabled=false", "--linter-enabled=false", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Biome: safe assist actions (--write)",
        },
      ];
    }

    return [
      {
        id: "biome-format-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "@biomejs/biome",
        capability: "format",
        executable: "biome",
        args: ["format", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Biome: format .",
      },
      {
        id: "biome-lint-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "@biomejs/biome",
        capability: "lint",
        executable: "biome",
        args: ["lint", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Biome: lint .",
      },
      {
        id: "biome-assist-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "@biomejs/biome",
        capability: "assist",
        executable: "biome",
        args: ["check", "--formatter-enabled=false", "--linter-enabled=false", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Biome: check assist actions",
      },
    ];
  }
}

// Prettier Adapter
export class PrettierAdapter implements ToolAdapter {
  public readonly id = "prettier";
  public readonly name = "Prettier";
  public readonly capabilities: readonly Capability[] = ["format"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const pkg = context.jsEnv?.packageJson;
    const hasPkgConfig = Boolean((pkg as any)?.prettier);
    const hasConfigFile = hasAnyConfigFile(context.cwd, [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.json5",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    ]);
    const hasConfig = hasPkgConfig || hasConfigFile;
    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: "prettier",
      requiredPackage: "prettier",
      hasConfig,
    });
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "prettier-format",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "prettier",
          capability: "format",
          executable: "prettier",
          args: ["--write", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Prettier: format",
        },
      ];
    }

    return [
      {
        id: "prettier-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "prettier",
        capability: "format",
        executable: "prettier",
        args: ["--check", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Prettier: format check",
      },
    ];
  }
}

// ESLint Adapter
export class EslintAdapter implements ToolAdapter {
  public readonly id = "eslint";
  public readonly name = "ESLint";
  public readonly capabilities: readonly Capability[] = ["lint"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const pkg = context.jsEnv?.packageJson;
    const hasPkgConfig = Boolean((pkg as any)?.eslintConfig);
    const hasConfigFile = hasAnyConfigFile(context.cwd, [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yaml",
      ".eslintrc.yml",
    ]);
    const hasConfig = hasPkgConfig || hasConfigFile;
    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: "eslint",
      requiredPackage: "eslint",
      hasConfig,
    });
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "eslint-lint-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "eslint",
          capability: "lint",
          executable: "eslint",
          args: ["--fix", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "ESLint: lint autofix",
        },
      ];
    }

    return [
      {
        id: "eslint-lint-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "eslint",
        capability: "lint",
        executable: "eslint",
        args: ["."],
        cwd: context.cwd,
        mode: "check",
        description: "ESLint: lint check",
      },
    ];
  }
}

// Oxlint Adapter
export class OxlintAdapter implements ToolAdapter {
  public readonly id = "oxlint";
  public readonly name = "Oxlint";
  public readonly capabilities: readonly Capability[] = ["lint"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const hasConfig = hasAnyConfigFile(context.cwd, [
      ".oxlintrc.json",
      "oxlint.json",
      "oxlint.config.ts",
      "oxlint.config.js",
    ]);
    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: "oxlint",
      requiredPackage: "oxlint",
      hasConfig,
    });
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "oxlint-lint-fix",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "oxlint",
          capability: "lint",
          executable: "oxlint",
          args: ["--fix", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Oxlint: lint autofix",
        },
      ];
    }

    return [
      {
        id: "oxlint-lint-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "oxlint",
        capability: "lint",
        executable: "oxlint",
        args: ["."],
        cwd: context.cwd,
        mode: "check",
        description: "Oxlint: lint check",
      },
    ];
  }
}

// Oxfmt Adapter
export class OxfmtAdapter implements ToolAdapter {
  public readonly id = "oxfmt";
  public readonly name = "Oxfmt";
  public readonly capabilities: readonly Capability[] = ["format"];

  public async detect(context: ProjectContext): Promise<AdapterDetectionResult> {
    const hasConfig = hasAnyConfigFile(context.cwd, [
      ".oxfmtrc.json",
      "oxfmt.json",
      "oxfmt.config.ts",
      "oxfmt.config.js",
    ]);
    return detectToolAvailability(context, {
      toolId: this.id,
      toolName: this.name,
      executable: "oxfmt",
      requiredPackage: "oxfmt",
      hasConfig,
    });
  }

  public plan(context: ProjectContext, mode: ExecutionMode): ExecutionTask[] {
    if (mode === "fix") {
      return [
        {
          id: "oxfmt-format",
          toolId: this.id,
          toolName: this.name,
          requiredPackage: "oxfmt",
          capability: "format",
          executable: "oxfmt",
          args: ["--write", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Oxfmt: format",
        },
      ];
    }

    return [
      {
        id: "oxfmt-check",
        toolId: this.id,
        toolName: this.name,
        requiredPackage: "oxfmt",
        capability: "format",
        executable: "oxfmt",
        args: ["--check", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Oxfmt: format check",
      },
    ];
  }
}
