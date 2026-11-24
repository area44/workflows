import fs from "node:fs";
import path from "node:path";

import type { ExecutionMode, ExecutionTask, ProjectContext } from "@/autofix/types";

import { resolveProjectBinary } from "@/autofix/executable-resolver";
import { hasVitePlusDependency } from "@/javascript-env";

import {
  BaseToolAdapter,
  AdapterConfig,
  detectToolAvailability,
  type DetectToolOptions,
} from "./base-adapter";
import { hasVitePlusCommand } from "./vite-plus-detector";

function hasVitePlusScript(scripts?: Record<string, string>): boolean {
  if (!scripts) return false;
  return Object.values(scripts).some((scriptBody) => {
    return hasVitePlusCommand(scriptBody, scripts);
  });
}

export { detectToolAvailability, type DetectToolOptions };

const vitePlusConfig: AdapterConfig = {
  id: "vite-plus",
  name: "Vite+",
  capabilities: ["autofix", "format", "lint"],
  executable: "vp",
  requiredPackage: "vite-plus",
  configFiles: ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"],
  fixTasks: [
    {
      id: "vite-plus-fmt",
      capability: "format",
      executable: "vp",
      args: ["fmt"],
      description: "Vite+: vp fmt",
    },
    {
      id: "vite-plus-lint-fix",
      capability: "lint",
      executable: "vp",
      args: ["lint", "--fix"],
      description: "Vite+: vp lint --fix",
    },
  ],
  checkTasks: [
    {
      id: "vite-plus-fmt-check",
      capability: "format",
      executable: "vp",
      args: ["fmt", "--check"],
      description: "Vite+: vp fmt --check",
    },
    {
      id: "vite-plus-lint",
      capability: "lint",
      executable: "vp",
      args: ["lint"],
      description: "Vite+: vp lint",
    },
  ],
  customDetect: async (context: ProjectContext) => {
    const hasConfig = vitePlusConfig.configFiles.some((f) =>
      fs.existsSync(path.join(context.cwd, f)),
    );
    const hasVpScript = hasVitePlusScript(context.jsEnv?.packageJson?.scripts);
    return { hasConfig, hasVpScript };
  },
  customPlan: async (context: ProjectContext, mode: ExecutionMode): Promise<ExecutionTask[]> => {
    const pkg = context.jsEnv?.packageJson;
    const hasDep = hasVitePlusDependency(pkg);
    const hasConfig = vitePlusConfig.configFiles.some((f) =>
      fs.existsSync(path.join(context.cwd, f)),
    );
    const hasVpScript = hasVitePlusScript(pkg?.scripts);
    const resolvedBin = await resolveProjectBinary(context.cwd, "vp");
    const hasExec = Boolean(resolvedBin);

    if (!hasDep && hasConfig && hasVpScript && !hasExec) {
      return [];
    }

    if (mode === "fix") {
      return [
        {
          id: "vite-plus-fmt",
          toolId: "vite-plus",
          toolName: "Vite+",
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
          toolId: "vite-plus",
          toolName: "Vite+",
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
        toolId: "vite-plus",
        toolName: "Vite+",
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
        toolId: "vite-plus",
        toolName: "Vite+",
        requiredPackage: "vite-plus",
        capability: "lint",
        executable: "vp",
        args: ["lint"],
        cwd: context.cwd,
        mode: "check",
        description: "Vite+: vp lint",
      },
    ];
  },
};

export class VitePlusAdapter extends BaseToolAdapter {
  constructor() {
    super(vitePlusConfig);
  }
}

const biomeConfig: AdapterConfig = {
  id: "biome",
  name: "Biome",
  capabilities: ["format", "lint", "assist"],
  executable: "biome",
  requiredPackage: "@biomejs/biome",
  extraPackages: ["biome"],
  configFiles: ["biome.json", "biome.jsonc"],
  fixTasks: [
    {
      id: "biome-format-fix",
      capability: "format",
      executable: "biome",
      args: ["format", "--write", "."],
      description: "Biome: format --write .",
    },
    {
      id: "biome-lint-fix",
      capability: "lint",
      executable: "biome",
      args: ["lint", "--write", "."],
      description: "Biome: lint --write .",
    },
    {
      id: "biome-assist-fix",
      capability: "assist",
      executable: "biome",
      args: ["check", "--write", "--formatter-enabled=false", "--linter-enabled=false", "."],
      description: "Biome: safe assist actions (--write)",
    },
  ],
  checkTasks: [
    {
      id: "biome-format-check",
      capability: "format",
      executable: "biome",
      args: ["format", "."],
      description: "Biome: format .",
    },
    {
      id: "biome-lint-check",
      capability: "lint",
      executable: "biome",
      args: ["lint", "."],
      description: "Biome: lint .",
    },
    {
      id: "biome-assist-check",
      capability: "assist",
      executable: "biome",
      args: ["check", "--formatter-enabled=false", "--linter-enabled=false", "."],
      description: "Biome: check assist actions",
    },
  ],
};

export class BiomeAdapter extends BaseToolAdapter {
  constructor() {
    super(biomeConfig);
  }
}

const prettierConfig: AdapterConfig = {
  id: "prettier",
  name: "Prettier",
  capabilities: ["format"],
  executable: "prettier",
  requiredPackage: "prettier",
  configFiles: [
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
  ],
  pkgConfigKeys: ["prettier"],
  fixTasks: [
    {
      id: "prettier-format",
      capability: "format",
      executable: "prettier",
      args: ["--write", "."],
      description: "Prettier: format",
    },
  ],
  checkTasks: [
    {
      id: "prettier-check",
      capability: "format",
      executable: "prettier",
      args: ["--check", "."],
      description: "Prettier: format check",
    },
  ],
};

export class PrettierAdapter extends BaseToolAdapter {
  constructor() {
    super(prettierConfig);
  }
}

const eslintConfig: AdapterConfig = {
  id: "eslint",
  name: "ESLint",
  capabilities: ["lint"],
  executable: "eslint",
  requiredPackage: "eslint",
  configFiles: [
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
  ],
  pkgConfigKeys: ["eslintConfig"],
  fixTasks: [
    {
      id: "eslint-lint-fix",
      capability: "lint",
      executable: "eslint",
      args: ["--fix", "."],
      description: "ESLint: lint autofix",
    },
  ],
  checkTasks: [
    {
      id: "eslint-lint-check",
      capability: "lint",
      executable: "eslint",
      args: ["."],
      description: "ESLint: lint check",
    },
  ],
};

export class EslintAdapter extends BaseToolAdapter {
  constructor() {
    super(eslintConfig);
  }
}

const oxlintConfig: AdapterConfig = {
  id: "oxlint",
  name: "Oxlint",
  capabilities: ["lint"],
  executable: "oxlint",
  requiredPackage: "oxlint",
  configFiles: [".oxlintrc.json", "oxlint.json", "oxlint.config.ts", "oxlint.config.js"],
  fixTasks: [
    {
      id: "oxlint-lint-fix",
      capability: "lint",
      executable: "oxlint",
      args: ["--fix", "."],
      description: "Oxlint: lint autofix",
    },
  ],
  checkTasks: [
    {
      id: "oxlint-lint-check",
      capability: "lint",
      executable: "oxlint",
      args: ["."],
      description: "Oxlint: lint check",
    },
  ],
};

export class OxlintAdapter extends BaseToolAdapter {
  constructor() {
    super(oxlintConfig);
  }
}

const oxfmtConfig: AdapterConfig = {
  id: "oxfmt",
  name: "Oxfmt",
  capabilities: ["format"],
  executable: "oxfmt",
  requiredPackage: "oxfmt",
  configFiles: [".oxfmtrc.json", "oxfmt.json", "oxfmt.config.ts", "oxfmt.config.js"],
  fixTasks: [
    {
      id: "oxfmt-format",
      capability: "format",
      executable: "oxfmt",
      args: ["--write", "."],
      description: "Oxfmt: format",
    },
  ],
  checkTasks: [
    {
      id: "oxfmt-check",
      capability: "format",
      executable: "oxfmt",
      args: ["--check", "."],
      description: "Oxfmt: format check",
    },
  ],
};

export class OxfmtAdapter extends BaseToolAdapter {
  constructor() {
    super(oxfmtConfig);
  }
}
