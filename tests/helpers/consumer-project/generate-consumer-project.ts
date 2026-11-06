import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "../../../src/utils/is-main-module.js";

/**
 * Normalizes a project name for Python package compatibility (PEP 508 / PEP 621).
 */
export function normalizePythonProjectName(name?: string): string {
  if (!name || typeof name !== "string") {
    return "consumer-project";
  }
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "consumer-project"
  );
}

export interface ConsumerProjectOptions {
  name?: string;
  action?: string;
  runtime?: string;
  pm?: string;
  packageManager?: string;
  toolchain?: string;
  type?: string;
  fixture?: string;
  hasJsProject?: boolean | string;
  hasPythonSource?: boolean | string;
  pythonPm?: string;
  pythonVersion?: string;
  ruffVersion?: string;
  markerContent?: string;
  allowNonEmpty?: boolean;
  overwrite?: boolean;
  customTemplatePath?: string;
  [key: string]: unknown;
}

interface ResolvedJsOptions {
  hasJs: boolean;
  action: string;
  runtime: string;
  rawPm: string;
  pmType: string;
  type: string;
  packageManager: string | undefined;
  toolchain: string;
}

interface ResolvedPythonOptions {
  hasPython: boolean;
  pythonPm: string;
  ruffVersion: string;
  pythonVersion: string;
}

/**
 * Determines whether a JavaScript project is present for the scenario.
 */
function isJsProjectPresent(options: ConsumerProjectOptions, type: string): boolean {
  if (typeof options.hasJsProject === "boolean") {
    return options.hasJsProject;
  }
  if (typeof options.hasJsProject === "string") {
    return options.hasJsProject !== "false";
  }
  return !type.startsWith("python-");
}

/**
 * Resolves the JS package manager string for package.json.
 */
function resolveJsPackageManager(rawPm: string, pmType: string, type: string): string | undefined {
  if (rawPm.includes("@")) {
    return rawPm;
  }
  if (pmType === "bun") {
    return "bun@1.4.0";
  }
  if (type === "minimal") {
    return undefined;
  }
  if (pmType === "pnpm") {
    return "pnpm@12.15.0";
  }
  return "npm@10.8.2";
}

/**
 * Resolves JavaScript configuration options for scenario generation.
 */
function resolveJsOptions(options: ConsumerProjectOptions): ResolvedJsOptions {
  const type = options.type || "basic";
  const action = options.action || "";
  const runtime = options.runtime || "node";
  const rawPm = options.pm || options.packageManager || "npm";
  const pmType = rawPm.startsWith("pnpm") ? "pnpm" : rawPm.startsWith("bun") ? "bun" : "npm";
  const hasJs = isJsProjectPresent(options, type);
  const packageManager = resolveJsPackageManager(rawPm, pmType, type);

  const toolchain =
    options.toolchain ||
    (type === "vite-plus"
      ? "vite-plus"
      : action === "pages" &&
          type !== "consumer-integration" &&
          options.fixture !== "consumer-project"
        ? "astro"
        : "none");

  return { hasJs, action, runtime, rawPm, pmType, type, packageManager, toolchain };
}

/**
 * Resolves Python configuration options for scenario generation.
 */
function resolvePythonOptions(
  options: ConsumerProjectOptions,
  type: string,
  action: string,
): ResolvedPythonOptions {
  let hasPython = true;
  if (typeof options.hasPythonSource === "boolean") {
    hasPython = options.hasPythonSource;
  } else if (typeof options.hasPythonSource === "string") {
    hasPython = options.hasPythonSource === "true";
  } else if (type === "python-none") {
    hasPython = false;
  } else if (
    action === "pages" &&
    type !== "consumer-integration" &&
    options.fixture !== "consumer-project"
  ) {
    hasPython = false;
  } else if (
    action === "autofix" &&
    !type.includes("python") &&
    type !== "mixed" &&
    type !== "mixed-bun" &&
    type !== "consumer-integration"
  ) {
    hasPython = false;
  }

  let pythonPm = options.pythonPm;
  if (!pythonPm) {
    if (type === "python-uv" || type === "python-conflicting") {
      pythonPm = "uv";
    } else if (
      type === "python-pip" ||
      type === "mixed" ||
      type === "mixed-bun" ||
      type === "consumer-integration" ||
      hasPython
    ) {
      pythonPm = "pip";
    } else {
      pythonPm = "";
    }
  }

  const ruffVersion =
    options.ruffVersion !== undefined
      ? options.ruffVersion
      : type === "python-pip" || type === "python-none"
        ? ""
        : "0.17.2";

  const pythonVersion = options.pythonVersion || "";

  return { hasPython, pythonPm, ruffVersion, pythonVersion };
}

/**
 * Builds JS scripts and html/astro files.
 */
function buildJsScriptsAndHtml(
  files: Record<string, string>,
  options: ConsumerProjectOptions,
  jsOpt: ResolvedJsOptions,
): { scripts: Record<string, string>; devDependencies: Record<string, string> } {
  const { action, toolchain, type, pmType } = jsOpt;
  const markerContent = options.markerContent || "AREA44 Workflows Consumer Project";

  let scripts: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};

  if (
    type === "consumer-integration" ||
    options.fixture === "consumer-project" ||
    (!action && !options.toolchain && type === "basic")
  ) {
    scripts = {
      build: "mkdir -p dist && cp index.html dist/index.html",
      lint: "node -e \"console.log('Linting JS...')\"",
      format: "node -e \"console.log('Formatting JS...')\"",
    };
    if (pmType === "bun") {
      devDependencies = { "@types/node": "^24.0.0" };
    }
    files["index.html"] =
      `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Consumer Project</title>\n  </head>\n  <body>\n    <h1>${markerContent}</h1>\n  </body>\n</html>\n`;
  } else if (toolchain === "vite-plus" || type === "vite-plus") {
    scripts = { build: "vp build" };
    devDependencies = { "vite-plus": "^1.4.0" };
    files["vite.config.ts"] = `export default {};\n`;
    files["index.html"] =
      `<!DOCTYPE html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Vite Plus</title></head>\n  <body><h1>${markerContent}</h1></body>\n</html>\n`;
  } else if (toolchain === "vite" || type === "vite") {
    scripts = { build: "vite build" };
    devDependencies = { vite: "^6.0.0" };
    files["vite.config.ts"] =
      `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`;
    files["index.html"] =
      `<!DOCTYPE html>\n<html>\n  <body>\n    <h1>${markerContent}</h1>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n`;
    files["src/main.ts"] = `console.log('vite app');\n`;
  } else if (
    action === "pages" ||
    toolchain === "astro" ||
    (action === "pages" && (type === "basic" || type === "minimal"))
  ) {
    scripts = { build: "astro build" };
    devDependencies = { astro: "^5.0.0" };
    files["astro.config.mjs"] =
      `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`;
    files["src/pages/index.astro"] =
      `---\n---\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Site</title></head>\n  <body><h1>${markerContent}</h1></body>\n</html>\n`;
  } else if (action === "autofix") {
    scripts = {
      format: "node -e \"console.log('Formatting JS...')\"",
      lint: "node -e \"console.log('Linting JS...')\"",
    };
    if (pmType === "bun") {
      devDependencies = { "@types/node": "^24.0.0" };
    }
  } else {
    scripts = {
      build: "mkdir -p dist && cp index.html dist/index.html",
      lint: "node -e \"console.log('Linting JS...')\"",
      format: "node -e \"console.log('Formatting JS...')\"",
    };
    if (pmType === "bun") {
      devDependencies = { "@types/node": "^24.0.0" };
    }
    files["index.html"] =
      `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" /><title>Consumer Project</title>\n  </head>\n  <body>\n    <h1>${markerContent}</h1>\n  </body>\n</html>\n`;
  }

  return { scripts, devDependencies };
}

let lockfileTemplates: Record<string, string> | null = null;

/**
 * Loads canonical lockfile templates lazily from lockfile-templates.json.
 */
export function getLockfileTemplates(customTemplatePath?: string): Record<string, string> {
  const templatePath =
    customTemplatePath ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lockfile-templates.json");

  if (!customTemplatePath && lockfileTemplates) {
    return lockfileTemplates;
  }

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing lockfile templates file at '${templatePath}'.`);
  }

  let rawContent = "";
  try {
    rawContent = fs.readFileSync(templatePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read lockfile templates file at '${templatePath}': ${msg}`);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed JSON in lockfile templates file at '${templatePath}': ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid template structure in lockfile templates file at '${templatePath}': expected object.`,
    );
  }

  for (const [key, val] of Object.entries(parsed)) {
    if (typeof val !== "string" || val.trim().length === 0) {
      throw new Error(
        `Invalid or empty template value for key '${key}' in lockfile templates file at '${templatePath}'.`,
      );
    }
  }

  if (!customTemplatePath) {
    lockfileTemplates = parsed as Record<string, string>;
  }
  return parsed as Record<string, string>;
}

/**
 * Builds package lockfiles (package-lock.json, pnpm-lock.yaml, bun.lock) using canonical templates.
 */
function buildJsLockfile(
  files: Record<string, string>,
  name: string,
  pmType: string,
  type: string,
  toolchain: string,
  customTemplatePath?: string,
): void {
  const templates = getLockfileTemplates(customTemplatePath);
  const templateKey = `${toolchain || "none"}:${pmType}`;

  if (!Object.prototype.hasOwnProperty.call(templates, templateKey)) {
    throw new Error(
      `Missing lockfile template for key '${templateKey}' in lockfile-templates.json.`,
    );
  }

  const lockfileContent = templates[templateKey];

  if (pmType === "npm") {
    files["package-lock.json"] = lockfileContent.replaceAll(
      "CONSUMER_PROJECT_NAME_PLACEHOLDER",
      name,
    );
  } else if (pmType === "pnpm") {
    files["pnpm-lock.yaml"] = lockfileContent.replaceAll("CONSUMER_PROJECT_NAME_PLACEHOLDER", name);
    files["pnpm-workspace.yaml"] =
      "packages:\n  - '.'\nallowBuilds:\n  esbuild: true\n  sharp: true\n  \"@img/sharp-libvips-linux-x64\": true\n";
  } else if (pmType === "bun") {
    if (lockfileContent && lockfileContent.trim().length > 0) {
      files["bun.lock"] = lockfileContent.replaceAll("CONSUMER_PROJECT_NAME_PLACEHOLDER", name);
    }
  }
}

/**
 * Builds JavaScript project files.
 */
function buildJsFiles(
  files: Record<string, string>,
  options: ConsumerProjectOptions,
  jsOpt: ResolvedJsOptions,
): void {
  const { action, runtime, pmType, type, packageManager, toolchain } = jsOpt;
  const name =
    options.name ||
    (options.type || options.action || options.toolchain
      ? type === "vite-plus"
        ? "test-vite-plus"
        : `test-${action || "project"}-${runtime}-${pmType}-${type}`
      : "consumer-project");

  const { scripts, devDependencies } = buildJsScriptsAndHtml(files, options, jsOpt);

  const packageJson: Record<string, unknown> = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts,
    ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
    ...(runtime === "bun" && pmType === "pnpm"
      ? { devEngines: { runtime: { name: "bun", version: ">=1.0.0" } } }
      : {}),
    ...(packageManager ? { packageManager } : {}),
  };

  files["package.json"] = JSON.stringify(packageJson, null, 2) + "\n";
  buildJsLockfile(files, name, pmType, type, toolchain, options.customTemplatePath);

  if (runtime === "node" && (pmType === "npm" || pmType === "bun") && type === "basic") {
    files[".node-version"] = "24.19.0\n";
  }
}

/**
 * Builds Python project files and manifests.
 */
function buildPythonFiles(
  files: Record<string, string>,
  options: ConsumerProjectOptions,
  pyOpt: ResolvedPythonOptions,
  pyProjectName: string,
): void {
  const { pythonPm, ruffVersion, pythonVersion } = pyOpt;
  const type = options.type || "basic";

  const mainPy = `def main() -> None:\n    print("AREA44 consumer project Python entrypoint")\n\n\nif __name__ == "__main__":\n    main()\n`;
  files["main.py"] = mainPy;

  const trimmedVer = pythonVersion ? pythonVersion.trim() : "";
  const isExact = /^\d+(?:\.\d+)+$/.test(
    trimmedVer
      .replace(/^python-?/i, "")
      .replace(/^v/i, "")
      .replace(/['"]/g, ""),
  );

  if (trimmedVer && isExact) {
    files[".python-version"] = `${trimmedVer}\n`;
  }

  const pyDeps: string[] = [];
  if (ruffVersion) {
    pyDeps.push(`ruff==${ruffVersion}`);
  }

  let requiresPythonStr = "";
  if (trimmedVer) {
    requiresPythonStr = /^[<>=!~]/.test(trimmedVer)
      ? `requires-python = "${trimmedVer}"\n`
      : `requires-python = ">=${trimmedVer}"\n`;
  }

  const pyprojectToml =
    `[project]\nname = "${pyProjectName}"\nversion = "0.1.0"\n` +
    requiresPythonStr +
    (pyDeps.length > 0
      ? `dependencies = [\n${pyDeps.map((d) => `  "${d}",`).join("\n")}\n]\n\n`
      : "\n") +
    `[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n\n[tool.setuptools.packages.find]\nwhere = ["."]\ninclude = ["*"]\n\n[tool.ruff]\nline-length = 88\n`;

  files["pyproject.toml"] = pyprojectToml;

  if (pythonPm === "uv" || type === "python-uv" || type === "python-conflicting") {
    files["uv.lock"] = 'version = 1\nrequires-python = ">=3.12"\n';
  }

  if (
    pythonPm === "pip" ||
    type === "python-pip" ||
    type === "python-conflicting" ||
    type === "mixed" ||
    type === "mixed-bun" ||
    type === "consumer-integration"
  ) {
    files["requirements.txt"] = ruffVersion ? `ruff==${ruffVersion}\n` : "requests==2.31.0\n";
  }
}

/**
 * Generates an in-memory map of filename to content for a test consumer project.
 */
export function generateConsumerProjectFiles(
  options: ConsumerProjectOptions = {},
): Record<string, string> {
  const jsOpt = resolveJsOptions(options);
  const pyOpt = resolvePythonOptions(options, jsOpt.type, jsOpt.action);

  const name =
    options.name ||
    (options.type || options.action || options.toolchain
      ? jsOpt.type === "vite-plus"
        ? "test-vite-plus"
        : `test-${jsOpt.action || "project"}-${jsOpt.runtime}-${jsOpt.pmType}-${jsOpt.type}`
      : "consumer-project");
  const pyProjectName = normalizePythonProjectName(name);

  const files: Record<string, string> = {};

  if (jsOpt.hasJs) {
    buildJsFiles(files, options, jsOpt);
  }

  if (pyOpt.hasPython) {
    buildPythonFiles(files, options, pyOpt, pyProjectName);
  } else if (jsOpt.type === "python-none") {
    files["README.md"] = "# Python None Project\n";
  }

  return files;
}

/**
 * Creates consumer project files in the specified target directory.
 */
export function createConsumerProject(
  targetDir: string,
  options: ConsumerProjectOptions = {},
): string {
  if (!targetDir || typeof targetDir !== "string") {
    throw new Error("Target directory path must be a non-empty string.");
  }

  const resolvedTarget = path.resolve(targetDir);

  if (fs.existsSync(resolvedTarget)) {
    const stat = fs.statSync(resolvedTarget);
    if (!stat.isDirectory()) {
      throw new Error(`Target path '${resolvedTarget}' exists and is not a directory.`);
    }
  } else {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  const files = generateConsumerProjectFiles(options);

  // Safety checks against non-empty target directories and colliding files
  const existingItems = fs.readdirSync(resolvedTarget);
  if (existingItems.length > 0) {
    if (!options.allowNonEmpty && !options.overwrite) {
      throw new Error(
        `Refusing to generate consumer project into non-empty directory '${resolvedTarget}'.`,
      );
    }

    if (!options.overwrite) {
      const colliding = Object.keys(files).filter((filename) =>
        fs.existsSync(path.join(resolvedTarget, filename)),
      );
      if (colliding.length > 0) {
        throw new Error(
          `Refusing to overwrite existing generated files in '${resolvedTarget}': ${colliding.join(", ")}. Pass 'overwrite: true' or '--overwrite' to allow.`,
        );
      }
    }
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(resolvedTarget, filename);
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf8");
  }

  return resolvedTarget;
}

/**
 * Parses CLI arguments into targetDir and options object.
 */
export function parseCliArgs(args: string[]): {
  targetDir: string | null;
  options: ConsumerProjectOptions;
} {
  const options: ConsumerProjectOptions = {};
  let targetDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--allow-non-empty") {
      options.allowNonEmpty = true;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        options[key] = val;
        i++;
      } else {
        options[key] = true;
      }
    } else if (!targetDir) {
      targetDir = arg;
    }
  }

  return { targetDir, options };
}

if (isMainModule(import.meta.url)) {
  const { targetDir, options } = parseCliArgs(process.argv.slice(2));

  if (!targetDir || targetDir.startsWith("-")) {
    console.error(
      "Error: Missing target directory argument. Usage: generate-consumer-project.ts <target-directory> [options]",
    );
    process.exit(1);
  }

  createConsumerProject(targetDir, options);
  console.log(`Successfully generated consumer project in ${path.resolve(targetDir)}`);
}
