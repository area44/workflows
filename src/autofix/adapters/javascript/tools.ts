import * as io from "@actions/io";
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

/**
 * Resolves local project binary safely without falling back to `npx` (which could download unpinned packages).
 * Checks node_modules/.bin/<tool> first, then PATH via io.which.
 */
export async function resolveProjectBinary(
  cwd: string,
  toolBinary: string,
): Promise<string | undefined> {
  const localBinPath = path.join(cwd, "node_modules", ".bin", toolBinary);
  if (fs.existsSync(localBinPath)) {
    return localBinPath;
  }

  const pathBin = await io.which(toolBinary, false);
  if (pathBin) {
    return pathBin;
  }

  return undefined;
}

async function requireToolBinary(
  cwd: string,
  toolId: string,
  toolName: string,
  binName: string,
  depName: string,
): Promise<string> {
  const resolved = await resolveProjectBinary(cwd, binName);
  if (!resolved) {
    throw new Error(
      `Configured tool "${toolName}" could not run: executable "${binName}" is not available in node_modules/.bin or PATH. Please install "${depName}" in project dependencies.`,
    );
  }
  return resolved;
}

// 1. Vite+ Adapter
export class VitePlusAdapter implements ToolAdapter {
  public readonly id = "vite-plus";
  public readonly name = "Vite+";
  public readonly capabilities: readonly Capability[] = ["autofix", "format", "lint"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasVitePlusDependency(pkg);
    const hasConfig = hasAnyConfigFile(context.cwd, [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "vite.config.cjs",
    ]);

    if (
      hasDep ||
      (hasConfig && pkg?.scripts && Object.values(pkg.scripts).some((s) => s.includes("vp ")))
    ) {
      return { detected: true, reason: "Vite+ dependency and/or configuration detected" };
    }
    return { detected: false, reason: "no Vite+ dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(context.cwd, this.id, this.name, "vp", "vite-plus");

    if (mode === "fix") {
      // In fix mode, run formatting and lint fixes without triggering validation/typechecking
      return [
        {
          id: "vite-plus-fmt",
          toolId: this.id,
          capability: "format",
          executable,
          args: ["fmt"],
          cwd: context.cwd,
          mode: "fix",
          description: "Vite+: vp fmt",
        },
        {
          id: "vite-plus-lint-fix",
          toolId: this.id,
          capability: "lint",
          executable,
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
        capability: "format",
        executable,
        args: ["fmt", "--check"],
        cwd: context.cwd,
        mode: "check",
        description: "Vite+: vp fmt --check",
      },
      {
        id: "vite-plus-lint",
        toolId: this.id,
        capability: "lint",
        executable,
        args: ["lint"],
        cwd: context.cwd,
        mode: "check",
        description: "Vite+: vp lint",
      },
    ];
  }
}

// 2. Biome Adapter
export class BiomeAdapter implements ToolAdapter {
  public readonly id = "biome";
  public readonly name = "Biome";
  public readonly capabilities: readonly Capability[] = ["autofix", "format", "lint"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasDependency(pkg, "@biomejs/biome");
    const hasConfig = hasAnyConfigFile(context.cwd, ["biome.json", "biome.jsonc"]);

    if (hasDep && hasConfig) {
      return { detected: true, reason: "Biome dependency and configuration detected" };
    }
    if (hasConfig) {
      return { detected: true, reason: "Biome configuration detected" };
    }
    if (hasDep) {
      return { detected: false, reason: "Biome dependency present without configuration file" };
    }
    return { detected: false, reason: "no Biome dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(
      context.cwd,
      this.id,
      this.name,
      "biome",
      "@biomejs/biome",
    );

    if (mode === "fix") {
      return [
        {
          id: "biome-check-fix",
          toolId: this.id,
          capability: "autofix",
          executable,
          args: ["check", "--write", "."],
          cwd: context.cwd,
          mode: "fix",
          description: "Biome: check --write .",
        },
      ];
    }

    return [
      {
        id: "biome-check",
        toolId: this.id,
        capability: "autofix",
        executable,
        args: ["check", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Biome: check .",
      },
    ];
  }
}

// 3. Prettier Adapter
export class PrettierAdapter implements ToolAdapter {
  public readonly id = "prettier";
  public readonly name = "Prettier";
  public readonly capabilities: readonly Capability[] = ["format"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasDependency(pkg, "prettier");
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

    if (hasDep && (hasPkgConfig || hasConfigFile)) {
      return { detected: true, reason: "Prettier dependency and configuration detected" };
    }
    if (hasPkgConfig || hasConfigFile) {
      return { detected: true, reason: "Prettier configuration detected" };
    }
    if (hasDep) {
      return { detected: false, reason: "Prettier dependency present without configuration" };
    }
    return { detected: false, reason: "no Prettier dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(
      context.cwd,
      this.id,
      this.name,
      "prettier",
      "prettier",
    );

    if (mode === "fix") {
      return [
        {
          id: "prettier-format",
          toolId: this.id,
          capability: "format",
          executable,
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
        capability: "format",
        executable,
        args: ["--check", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Prettier: format check",
      },
    ];
  }
}

// 4. ESLint Adapter
export class EslintAdapter implements ToolAdapter {
  public readonly id = "eslint";
  public readonly name = "ESLint";
  public readonly capabilities: readonly Capability[] = ["lint"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasDependency(pkg, "eslint");
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

    if (hasDep && (hasPkgConfig || hasConfigFile)) {
      return { detected: true, reason: "ESLint dependency and configuration detected" };
    }
    if (hasPkgConfig || hasConfigFile) {
      return { detected: true, reason: "ESLint configuration detected" };
    }
    if (hasDep) {
      return { detected: false, reason: "ESLint dependency present without configuration" };
    }
    return { detected: false, reason: "no ESLint dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(context.cwd, this.id, this.name, "eslint", "eslint");

    if (mode === "fix") {
      return [
        {
          id: "eslint-lint-fix",
          toolId: this.id,
          capability: "lint",
          executable,
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
        capability: "lint",
        executable,
        args: ["."],
        cwd: context.cwd,
        mode: "check",
        description: "ESLint: lint check",
      },
    ];
  }
}

// 5. Oxlint Adapter
export class OxlintAdapter implements ToolAdapter {
  public readonly id = "oxlint";
  public readonly name = "Oxlint";
  public readonly capabilities: readonly Capability[] = ["lint"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasDependency(pkg, "oxlint");
    const hasConfig = hasAnyConfigFile(context.cwd, [
      ".oxlintrc.json",
      "oxlint.json",
      "oxlint.config.ts",
      "oxlint.config.js",
    ]);

    if (hasDep && hasConfig) {
      return { detected: true, reason: "Oxlint dependency and configuration detected" };
    }
    if (hasConfig) {
      return { detected: true, reason: "Oxlint configuration detected" };
    }
    if (hasDep) {
      return { detected: false, reason: "Oxlint dependency present without configuration" };
    }
    return { detected: false, reason: "no Oxlint dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(context.cwd, this.id, this.name, "oxlint", "oxlint");

    if (mode === "fix") {
      return [
        {
          id: "oxlint-lint-fix",
          toolId: this.id,
          capability: "lint",
          executable,
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
        capability: "lint",
        executable,
        args: ["."],
        cwd: context.cwd,
        mode: "check",
        description: "Oxlint: lint check",
      },
    ];
  }
}

// 6. Oxfmt Adapter
export class OxfmtAdapter implements ToolAdapter {
  public readonly id = "oxfmt";
  public readonly name = "Oxfmt";
  public readonly capabilities: readonly Capability[] = ["format"];

  public detect(context: ProjectContext): AdapterDetectionResult {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasDependency(pkg, "oxfmt");
    const hasConfig = hasAnyConfigFile(context.cwd, [
      ".oxfmtrc.json",
      "oxfmt.json",
      "oxfmt.config.ts",
      "oxfmt.config.js",
    ]);

    if (hasDep && hasConfig) {
      return { detected: true, reason: "Oxfmt dependency and configuration detected" };
    }
    if (hasConfig) {
      return { detected: true, reason: "Oxfmt configuration detected" };
    }
    if (hasDep) {
      return { detected: false, reason: "Oxfmt dependency present without configuration" };
    }
    return { detected: false, reason: "no Oxfmt dependency or configuration" };
  }

  public async plan(context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> {
    const executable = await requireToolBinary(context.cwd, this.id, this.name, "oxfmt", "oxfmt");

    if (mode === "fix") {
      return [
        {
          id: "oxfmt-format",
          toolId: this.id,
          capability: "format",
          executable,
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
        capability: "format",
        executable,
        args: ["--check", "."],
        cwd: context.cwd,
        mode: "check",
        description: "Oxfmt: format check",
      },
    ];
  }
}
