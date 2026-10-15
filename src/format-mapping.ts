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

  const hasBiomeConfig =
    fs.existsSync(resolveFilePath("biome.json", cwd)) ||
    fs.existsSync(resolveFilePath("biome.jsonc", cwd));
  const hasBiomeDep = Boolean(deps["@biomejs/biome"] || deps["biome"]);

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

  const hasTaploConfig =
    fs.existsSync(resolveFilePath("taplo.toml", cwd)) ||
    fs.existsSync(resolveFilePath(".taplorc", cwd));
  const hasTaploDep = Boolean(deps["taplo"] || deps["@taplo/cli"]);

  const hasDprintConfig =
    fs.existsSync(resolveFilePath("dprint.json", cwd)) ||
    fs.existsSync(resolveFilePath(".dprint.json", cwd));
  const hasDprintDep = Boolean(deps["dprint"]);

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

function selectJsTsSelections(detection: ToolDetectionResult): FormatToolSelection[] {
  if (detection.hasPackageScripts) {
    return [
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
    ];
  }
  if (detection.hasBiomeConfig || detection.hasBiomeDep) {
    return [
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
    ];
  }
  if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    return [
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
    ];
  }
  if (detection.hasEslintConfig || detection.hasEslintDep) {
    return [
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
    ];
  }
  return [];
}

function selectJsonSelections(detection: ToolDetectionResult): FormatToolSelection[] {
  if (detection.hasPackageScripts) {
    return [
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
    ];
  }
  if (detection.hasBiomeConfig || detection.hasBiomeDep) {
    return [
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
    ];
  }
  if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    return [
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
    ];
  }
  if (detection.hasDprintConfig || detection.hasDprintDep) {
    return [
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
    ];
  }
  return [];
}

function selectYamlSelections(detection: ToolDetectionResult): FormatToolSelection[] {
  if (detection.hasPackageScripts) {
    return [
      {
        format: "yaml",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for YAML.",
      },
    ];
  }
  if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    return [
      {
        format: "yaml",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for YAML.",
      },
    ];
  }
  return [];
}

function selectTomlSelections(detection: ToolDetectionResult): FormatToolSelection[] {
  if (detection.hasPackageScripts) {
    return [
      {
        format: "toml",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for TOML.",
      },
    ];
  }
  if (detection.hasTaploConfig || detection.hasTaploDep) {
    return [
      {
        format: "toml",
        tool: "taplo",
        reason: "Taplo configuration or dependency detected for TOML.",
      },
    ];
  }
  if (
    (detection.hasPrettierConfig || detection.hasPrettierDep) &&
    detection.hasPrettierTomlPlugin
  ) {
    return [
      {
        format: "toml",
        tool: "prettier",
        reason: "Prettier detected with prettier-plugin-toml for TOML.",
      },
    ];
  }
  return [];
}

function selectMarkdownSelections(detection: ToolDetectionResult): FormatToolSelection[] {
  if (detection.hasPackageScripts) {
    return [
      {
        format: "markdown",
        tool: "package-scripts",
        reason: "Explicit package.json scripts take primary precedence for Markdown.",
      },
    ];
  }
  if (detection.hasPrettierConfig || detection.hasPrettierDep) {
    return [
      {
        format: "markdown",
        tool: "prettier",
        reason: "Prettier configuration or dependency detected for Markdown.",
      },
    ];
  }
  if (detection.hasDprintConfig || detection.hasDprintDep) {
    return [
      {
        format: "markdown",
        tool: "dprint",
        reason: "dprint configuration or dependency detected for Markdown.",
      },
    ];
  }
  return [];
}

function buildPrettierCommand(formats: SupportedFormat[], execPrefix: string): ToolCommand | null {
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

  if (patterns.length === 0) return null;

  const patternGlob =
    patterns.length === 1 ? `**/*.${patterns[0]}` : `**/*.{${patterns.join(",")}}`;
  return {
    tool: "prettier",
    command: `${execPrefix} prettier --write "${patternGlob}"`,
    args: ["prettier", "--write", patternGlob],
    formats,
    reason: `Running Prettier format for formats: ${formats.join(", ")}.`,
  };
}

function buildToolCommand(
  tool: FormatterTool,
  formats: SupportedFormat[],
  execPrefix: string,
): ToolCommand | null {
  switch (tool) {
    case "biome":
      return {
        tool: "biome",
        command: `${execPrefix} biome check --write .`,
        args: ["biome", "check", "--write", "."],
        formats,
        reason: `Running Biome autofix for formats: ${formats.join(", ")}.`,
      };
    case "prettier":
      return buildPrettierCommand(formats, execPrefix);
    case "taplo":
      return {
        tool: "taplo",
        command: `${execPrefix} taplo fmt`,
        args: ["taplo", "fmt"],
        formats,
        reason: "Running Taplo format for TOML.",
      };
    case "dprint":
      return {
        tool: "dprint",
        command: `${execPrefix} dprint fmt`,
        args: ["dprint", "fmt"],
        formats,
        reason: `Running dprint format for formats: ${formats.join(", ")}.`,
      };
    case "eslint":
      return {
        tool: "eslint",
        command: `${execPrefix} eslint --fix .`,
        args: ["eslint", "--fix", "."],
        formats,
        reason: `Running ESLint fix for formats: ${formats.join(", ")}.`,
      };
    default:
      return null;
  }
}

function getExecPrefix(pmName: string): string {
  switch (pmName.toLowerCase()) {
    case "pnpm":
      return "pnpm exec";
    case "bun":
      return "bunx";
    case "npm":
    default:
      return "npx";
  }
}

export function buildFormatExecutionPlan(
  cwd: string = process.cwd(),
  pmName: string = "npm",
): FormatExecutionPlan {
  const detection = detectToolConfiguration(cwd);
  const selections: FormatToolSelection[] = [
    ...selectJsTsSelections(detection),
    ...selectJsonSelections(detection),
    ...selectYamlSelections(detection),
    ...selectTomlSelections(detection),
    ...selectMarkdownSelections(detection),
    { format: "python", tool: "ruff", reason: "Ruff is the primary Python formatter and linter." },
  ];

  const toolFormatMap = new Map<FormatterTool, SupportedFormat[]>();
  for (const sel of selections) {
    if (sel.tool === "package-scripts" || sel.tool === "ruff") {
      continue;
    }
    const existing = toolFormatMap.get(sel.tool) || [];
    if (!existing.includes(sel.format)) {
      existing.push(sel.format);
      toolFormatMap.set(sel.tool, existing);
    }
  }

  const execPrefix = getExecPrefix(pmName);
  const commands: ToolCommand[] = [];

  for (const [tool, formats] of toolFormatMap.entries()) {
    const cmd = buildToolCommand(tool, formats, execPrefix);
    if (cmd) {
      commands.push(cmd);
    }
  }

  return {
    selections,
    commands,
  };
}
