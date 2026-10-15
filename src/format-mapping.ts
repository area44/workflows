import fs from "node:fs";
import path from "node:path";

export type SupportedFormat =
  | "javascript"
  | "typescript"
  | "python"
  | "json"
  | "jsonc"
  | "yaml"
  | "toml"
  | "markdown";

export type FormatterTool =
  | "package-scripts"
  | "ruff"
  | "biome"
  | "prettier"
  | "taplo"
  | "dprint"
  | "eslint";

export interface FormatDefinition {
  id: SupportedFormat;
  name: string;
  extensions: string[];
  specialFiles?: string[];
}

export const SUPPORTED_FORMATS: Record<SupportedFormat, FormatDefinition> = {
  javascript: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
  },
  typescript: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".mts", ".cts", ".tsx"],
  },
  python: {
    id: "python",
    name: "Python",
    extensions: [".py", ".pyi"],
  },
  json: {
    id: "json",
    name: "JSON",
    extensions: [".json"],
  },
  jsonc: {
    id: "jsonc",
    name: "JSON with Comments",
    extensions: [".jsonc"],
    specialFiles: ["tsconfig.json", "tsconfig.*.json", ".vscode/*.json"],
  },
  yaml: {
    id: "yaml",
    name: "YAML",
    extensions: [".yaml", ".yml"],
  },
  toml: {
    id: "toml",
    name: "TOML",
    extensions: [".toml"],
  },
  markdown: {
    id: "markdown",
    name: "Markdown",
    extensions: [".md", ".markdown"],
  },
};

export interface ToolDetectionResult {
  hasPackageScripts: boolean;
  hasBiomeConfig: boolean;
  hasBiomeDep: boolean;
  hasPrettierConfig: boolean;
  hasPrettierDep: boolean;
  hasPrettierTomlPlugin: boolean;
  hasTaploConfig: boolean;
  hasTaploDep: boolean;
  hasDprintConfig: boolean;
  hasDprintDep: boolean;
  hasEslintConfig: boolean;
  hasEslintDep: boolean;
}

export interface FormatToolSelection {
  format: SupportedFormat;
  tool: FormatterTool;
  reason: string;
}

export interface ToolCommand {
  tool: FormatterTool;
  command: string;
  args: string[];
  formats: SupportedFormat[];
  reason: string;
}

export interface FormatExecutionPlan {
  selections: FormatToolSelection[];
  commands: ToolCommand[];
}

function resolveFilePath(filename: string, cwd: string): string {
  if (cwd === process.cwd()) {
    return filename;
  }
  return path.join(cwd, filename);
}

function readJsonFile(filePath: string): any {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

export function detectToolConfiguration(cwd: string = process.cwd()): ToolDetectionResult {
  const pkgPath = resolveFilePath("package.json", cwd);
  const pkg = readJsonFile(pkgPath) || {};

  const scripts = pkg.scripts || {};
  const hasPackageScripts = Boolean(scripts.check || scripts.format || scripts.fmt || scripts.lint);

  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

  // Biome detection
  const hasBiomeConfig =
    fs.existsSync(resolveFilePath("biome.json", cwd)) ||
    fs.existsSync(resolveFilePath("biome.jsonc", cwd));
  const hasBiomeDep = Boolean(deps["@biomejs/biome"] || deps["biome"]);

  // Prettier detection
  const prettierConfigFiles = [
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
    ".prettierignore",
  ];
  const hasPrettierConfig = prettierConfigFiles.some((file) =>
    fs.existsSync(resolveFilePath(file, cwd)),
  );
  const hasPrettierDep = Boolean(deps["prettier"]);
  const hasPrettierTomlPlugin = Boolean(
    deps["prettier-plugin-toml"] || deps["@prettier/plugin-toml"],
  );

  // Taplo detection
  const hasTaploConfig =
    fs.existsSync(resolveFilePath("taplo.toml", cwd)) ||
    fs.existsSync(resolveFilePath(".taplorc", cwd));
  const hasTaploDep = Boolean(deps["taplo"] || deps["@taplo/cli"]);

  // dprint detection
  const hasDprintConfig =
    fs.existsSync(resolveFilePath("dprint.json", cwd)) ||
    fs.existsSync(resolveFilePath(".dprint.json", cwd));
  const hasDprintDep = Boolean(deps["dprint"]);

  // ESLint detection
  const eslintConfigFiles = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    ".eslintrc.json",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
  ];
  const hasEslintConfig = eslintConfigFiles.some((file) =>
    fs.existsSync(resolveFilePath(file, cwd)),
  );
  const hasEslintDep = Boolean(deps["eslint"]);

  return {
    hasPackageScripts,
    hasBiomeConfig,
    hasBiomeDep,
    hasPrettierConfig,
    hasPrettierDep,
    hasPrettierTomlPlugin,
    hasTaploConfig,
    hasTaploDep,
    hasDprintConfig,
    hasDprintDep,
    hasEslintConfig,
    hasEslintDep,
  };
}

export function buildFormatExecutionPlan(
  cwd: string = process.cwd(),
  pmName: string = "npm",
): FormatExecutionPlan {
  const detection = detectToolConfiguration(cwd);
  const selections: FormatToolSelection[] = [];

  // Helper for runner CLI executable based on package manager
  const getExecPrefix = (): string => {
    switch (pmName.toLowerCase()) {
      case "pnpm":
        return "pnpm exec";
      case "bun":
        return "bunx";
      case "npm":
      default:
        return "npx";
    }
  };

  const execPrefix = getExecPrefix();

  // 1. JavaScript & TypeScript
  if (detection.hasPackageScripts) {
    selections.push(
      {
        format: "javascript",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for JavaScript.",
      },
      {
        format: "typescript",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for TypeScript.",
      },
    );
  } else if (detection.hasBiomeConfig || detection.hasBiomeDep) {
    selections.push(
      {
        format: "javascript",
        tool: "biome",
        reason: "Biome configuration or dependency detected for JavaScript.",
      },
      {
        format: "typescript",
        tool: "biome",
        reason: "Biome configuration or dependency detected for TypeScript.",
      },
    );
  } else if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    selections.push(
      {
        format: "javascript",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for JavaScript.",
      },
      {
        format: "typescript",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for TypeScript.",
      },
    );
  } else if (detection.hasEslintConfig || detection.hasEslintDep) {
    selections.push(
      {
        format: "javascript",
        tool: "eslint",
        reason: "ESLint configuration or dependency detected for JavaScript.",
      },
      {
        format: "typescript",
        tool: "eslint",
        reason: "ESLint configuration or dependency detected for TypeScript.",
      },
    );
  }

  // 2. JSON & JSONC
  if (detection.hasPackageScripts) {
    selections.push(
      {
        format: "json",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for JSON.",
      },
      {
        format: "jsonc",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for JSONC.",
      },
    );
  } else if (detection.hasBiomeConfig || detection.hasBiomeDep) {
    selections.push(
      {
        format: "json",
        tool: "biome",
        reason: "Biome configuration or dependency detected for JSON.",
      },
      {
        format: "jsonc",
        tool: "biome",
        reason: "Biome configuration or dependency detected for JSONC.",
      },
    );
  } else if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    selections.push(
      {
        format: "json",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for JSON.",
      },
      {
        format: "jsonc",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for JSONC.",
      },
    );
  } else if (detection.hasDprintConfig || detection.hasDprintDep) {
    selections.push(
      {
        format: "json",
        tool: "dprint",
        reason: "dprint configuration or dependency detected for JSON.",
      },
      {
        format: "jsonc",
        tool: "dprint",
        reason: "dprint configuration or dependency detected for JSONC.",
      },
    );
  }

  // 3. YAML
  if (detection.hasPackageScripts) {
    selections.push({
      format: "yaml",
      tool: "package-scripts",
      reason: "Explicit package.json scripts take primary precedence for YAML.",
    });
  } else if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    selections.push({
      format: "yaml",
      tool: "prettier",
      reason: "Prettier configuration or dependency detected for YAML.",
    });
  }

  // 4. TOML
  if (detection.hasPackageScripts) {
    selections.push({
      format: "toml",
      tool: "package-scripts",
      reason: "Explicit package.json scripts take primary precedence for TOML.",
    });
  } else if (detection.hasTaploConfig || detection.hasTaploDep) {
    selections.push({
      format: "toml",
      tool: "taplo",
      reason: "Taplo configuration or dependency detected for TOML.",
    });
  } else if (
    (detection.hasPrettierConfig || detection.hasPrettierDep) &&
    detection.hasPrettierTomlPlugin
  ) {
    selections.push({
      format: "toml",
      tool: "prettier",
      reason: "Prettier detected with prettier-plugin-toml for TOML.",
    });
  }

  // 5. Markdown
  if (detection.hasPackageScripts) {
    selections.push({
      format: "markdown",
      tool: "package-scripts",
      reason: "Explicit package.json scripts take primary precedence for Markdown.",
    });
  } else if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    selections.push({
      format: "markdown",
      tool: "prettier",
      reason: "Prettier configuration or dependency detected for Markdown.",
    });
  } else if (detection.hasDprintConfig || detection.hasDprintDep) {
    selections.push({
      format: "markdown",
      tool: "dprint",
      reason: "dprint configuration or dependency detected for Markdown.",
    });
  }

  // Python is always assigned to ruff
  selections.push({
    format: "python",
    tool: "ruff",
    reason: "Ruff is the primary Python formatter and linter.",
  });

  // Now group selections by tool to produce non-overlapping execution commands
  const toolFormatMap = new Map<FormatterTool, SupportedFormat[]>();
  for (const sel of selections) {
    if (sel.tool === "package-scripts" || sel.tool === "ruff") {
      continue; // Handled directly by executeJsWorkflow and ruff-action respectively
    }
    const existing = toolFormatMap.get(sel.tool) || [];
    if (!existing.includes(sel.format)) {
      existing.push(sel.format);
      toolFormatMap.set(sel.tool, existing);
    }
  }

  const commands: ToolCommand[] = [];

  // Generate commands for standalone tools (when not handled by package-scripts)
  if (toolFormatMap.has("biome")) {
    const formats = toolFormatMap.get("biome")!;
    commands.push({
      tool: "biome",
      command: `${execPrefix} biome check --write .`,
      args: ["biome", "check", "--write", "."],
      formats,
      reason: `Running Biome autofix for formats: ${formats.join(", ")}.`,
    });
  }

  if (toolFormatMap.has("prettier")) {
    const formats = toolFormatMap.get("prettier")!;
    const patterns: string[] = [];
    if (formats.includes("javascript") || formats.includes("typescript")) {
      patterns.push("js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx");
    }
    if (formats.includes("json") || formats.includes("jsonc")) {
      patterns.push("json", "jsonc");
    }
    if (formats.includes("yaml")) {
      patterns.push("yaml", "yml");
    }
    if (formats.includes("toml")) {
      patterns.push("toml");
    }
    if (formats.includes("markdown")) {
      patterns.push("md", "markdown");
    }

    if (patterns.length > 0) {
      const patternGlob =
        patterns.length === 1 ? `**/*.${patterns[0]}` : `**/*.{${patterns.join(",")}}`;
      commands.push({
        tool: "prettier",
        command: `${execPrefix} prettier --write "${patternGlob}"`,
        args: ["prettier", "--write", patternGlob],
        formats,
        reason: `Running Prettier format for formats: ${formats.join(", ")}.`,
      });
    }
  }

  if (toolFormatMap.has("taplo")) {
    const formats = toolFormatMap.get("taplo")!;
    commands.push({
      tool: "taplo",
      command: `${execPrefix} taplo fmt`,
      args: ["taplo", "fmt"],
      formats,
      reason: "Running Taplo format for TOML.",
    });
  }

  if (toolFormatMap.has("dprint")) {
    const formats = toolFormatMap.get("dprint")!;
    commands.push({
      tool: "dprint",
      command: `${execPrefix} dprint fmt`,
      args: ["dprint", "fmt"],
      formats,
      reason: `Running dprint format for formats: ${formats.join(", ")}.`,
    });
  }

  if (toolFormatMap.has("eslint")) {
    const formats = toolFormatMap.get("eslint")!;
    commands.push({
      tool: "eslint",
      command: `${execPrefix} eslint --fix .`,
      args: ["eslint", "--fix", "."],
      formats,
      reason: `Running ESLint fix for formats: ${formats.join(", ")}.`,
    });
  }

  return {
    selections,
    commands,
  };
}
