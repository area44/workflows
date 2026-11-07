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

// 2. Biome Adapter
export class BiomeAdapter implements ToolAdapter {
  public readonly id = "biome";
  public readonly name = "Biome";
  public readonly capabilities: readonly Capability[] = ["format", "lint"];

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
