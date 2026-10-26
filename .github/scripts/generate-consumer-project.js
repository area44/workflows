#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Normalizes a project name for Python package compatibility (PEP 508 / PEP 621).
 * @param {string} [name]
 * @returns {string}
 */
export function normalizePythonProjectName(name) {
  if (!name || typeof name !== "string") {
    return "consumer-project";
  }
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "consumer-project";
}

/**
 * @typedef {Object} ConsumerProjectOptions
 * @property {string} [name]
 * @property {string} [action]
 * @property {string} [runtime]
 * @property {string} [pm]
 * @property {string} [packageManager]
 * @property {string} [toolchain]
 * @property {string} [type]
 * @property {string} [fixture]
 * @property {boolean|string} [hasJsProject]
 * @property {boolean|string} [hasPythonSource]
 * @property {string} [pythonPm]
 * @property {string} [pythonVersion]
 * @property {string} [ruffVersion]
 * @property {string} [markerContent]
 * @property {boolean} [allowNonEmpty]
 * @property {boolean} [overwrite]
 */

/**
 * Determines whether a JavaScript project is present for the scenario.
 * @param {ConsumerProjectOptions} options
 * @param {string} type
 */
function isJsProjectPresent(options, type) {
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
 * @param {string} rawPm
 * @param {string} pmType
 * @param {string} type
 */
function resolveJsPackageManager(rawPm, pmType, type) {
  if (rawPm.includes("@")) {
    return rawPm;
  }
  if (type === "minimal") {
    return undefined;
  }
  if (pmType === "pnpm") {
    return "pnpm@12.15.0";
  }
  if (pmType === "bun") {
    return "bun@1.4.0";
  }
  return "npm@10.8.2";
}

/**
 * Resolves JavaScript configuration options for scenario generation.
 * @param {ConsumerProjectOptions} options
 */
function resolveJsOptions(options) {
  const type = options.type || "basic";
  const action = options.action || "";
  const runtime = options.runtime || "node";
  const rawPm = options.pm || options.packageManager || "npm";
  const pmType = rawPm.startsWith("pnpm") ? "pnpm" : rawPm.startsWith("bun") ? "bun" : "npm";
  const hasJs = isJsProjectPresent(options, type);
  const packageManager = resolveJsPackageManager(rawPm, pmType, type);

  const toolchain =
    options.toolchain ||
    (type === "vite"
      ? "vite"
      : type === "vite-plus"
      ? "vite-plus"
      : action === "pages" && type !== "consumer-integration" && options.fixture !== "consumer-project"
      ? "astro"
      : "none");

  return { hasJs, action, runtime, rawPm, pmType, type, packageManager, toolchain };
}

/**
 * Resolves Python configuration options for scenario generation.
 * @param {ConsumerProjectOptions} options
 * @param {string} type
 * @param {string} action
 */
function resolvePythonOptions(options, type, action) {
  let hasPython = true;
  if (typeof options.hasPythonSource === "boolean") {
    hasPython = options.hasPythonSource;
  } else if (typeof options.hasPythonSource === "string") {
    hasPython = options.hasPythonSource === "true";
  } else if (type === "python-none") {
    hasPython = false;
  } else if (action === "pages" && type !== "consumer-integration" && options.fixture !== "consumer-project") {
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

  return { hasPython, pythonPm, ruffVersion };
}

/**
 * Builds JS scripts and html/astro files.
 * @param {Record<string, string>} files
 * @param {ConsumerProjectOptions} options
 * @param {ReturnType<typeof resolveJsOptions>} jsOpt
 */
function buildJsScriptsAndHtml(files, options, jsOpt) {
  const { action, toolchain, type } = jsOpt;
  const markerContent = options.markerContent || "AREA44 Workflows Consumer Project";

  let scripts = {};
  let devDependencies = {};

  if (
    type === "consumer-integration" ||
    options.fixture === "consumer-project" ||
    (!action && !options.toolchain && type === "basic")
  ) {
    scripts = {
      build: "mkdir -p dist && cp index.html dist/index.html",
      lint: 'node -e "console.log(\'Linting JS...\')"',
      format: 'node -e "console.log(\'Formatting JS...\')"',
    };
    files["index.html"] = `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Consumer Project</title>\n  </head>\n  <body>\n    <h1>${markerContent}</h1>\n  </body>\n</html>\n`;
  } else if (toolchain === "vite-plus" || type === "vite-plus") {
    scripts = { build: "vp build" };
    devDependencies = { "vite-plus": "^1.4.0" };
    files["vite.config.ts"] = `export default {};\n`;
    files["index.html"] = `<!DOCTYPE html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Vite Plus</title></head>\n  <body><h1>${markerContent}</h1></body>\n</html>\n`;
  } else if (toolchain === "vite" || type === "vite") {
    scripts = { build: "vite build" };
    devDependencies = { vite: "^6.0.0" };
    files["vite.config.ts"] = `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`;
    files["index.html"] = `<!DOCTYPE html>\n<html>\n  <body>\n    <h1>${markerContent}</h1>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n`;
    files["src/main.ts"] = `console.log('vite app');\n`;
  } else if (
    action === "pages" ||
    toolchain === "astro" ||
    (action === "pages" && (type === "basic" || type === "minimal"))
  ) {
    scripts = { build: "astro build" };
    devDependencies = { astro: "^5.0.0" };
    files["astro.config.mjs"] = `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`;
    files["src/pages/index.astro"] = `---\n---\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Site</title></head>\n  <body><h1>${markerContent}</h1></body>\n</html>\n`;
  } else if (action === "autofix") {
    scripts = {
      format: 'node -e "console.log(\'Formatting JS...\')"',
      lint: 'node -e "console.log(\'Linting JS...\')"',
    };
  } else {
    scripts = {
      build: "mkdir -p dist && cp index.html dist/index.html",
      lint: 'node -e "console.log(\'Linting JS...\')"',
      format: 'node -e "console.log(\'Formatting JS...\')"',
    };
    files["index.html"] = `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Consumer Project</title>\n  </head>\n  <body>\n    <h1>${markerContent}</h1>\n  </body>\n</html>\n`;
  }

  return { scripts, devDependencies };
}

// Pre-generated canonical lockfile templates loaded lazily from lockfile-templates.json
let lockfileTemplates = null;
function getLockfileTemplates() {
  if (!lockfileTemplates) {
    const templatePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "lockfile-templates.json"
    );
    if (fs.existsSync(templatePath)) {
      try {
        lockfileTemplates = JSON.parse(fs.readFileSync(templatePath, "utf8"));
      } catch (err) {
        lockfileTemplates = {};
      }
    } else {
      lockfileTemplates = {};
    }
  }
  return lockfileTemplates;
}

/**
 * Builds JS lockfiles.
 * @param {Record<string, string>} files
 * @param {string} name
 * @param {string} pmType
 * @param {string} type
 * @param {string} toolchain
 */
function buildJsLockfile(files, name, pmType, type, toolchain) {
  const templates = getLockfileTemplates();
  const templateKey = `${toolchain || "none"}:${pmType}`;
  const lockfileContent = templates[templateKey];

  if (pmType === "npm") {
    if (lockfileContent) {
      files["package-lock.json"] = lockfileContent.replaceAll("CONSUMER_PROJECT_NAME_PLACEHOLDER", name);
    } else {
      const packageLockJson = {
        name,
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name,
            version: "1.0.0",
            license: "MIT",
          },
        },
      };
      files["package-lock.json"] = JSON.stringify(packageLockJson, null, 2) + "\n";
    }
  } else if (pmType === "pnpm") {
    if (lockfileContent) {
      files["pnpm-lock.yaml"] = lockfileContent.replaceAll("CONSUMER_PROJECT_NAME_PLACEHOLDER", name);
    } else {
      files["pnpm-lock.yaml"] = "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n";
    }
    if (type === "basic" || type === "minimal") {
      files["pnpm-workspace.yaml"] = "packages:\n  - '.'\n";
    }
  } else if (pmType === "bun") {
    if (lockfileContent) {
      files["bun.lock"] = lockfileContent.replaceAll("CONSUMER_PROJECT_NAME_PLACEHOLDER", name);
    }
  }
}

/**
 * Generates JavaScript files for a given scenario.
 * @param {Record<string, string>} files
 * @param {ConsumerProjectOptions} options
 * @param {ReturnType<typeof resolveJsOptions>} jsOpt
 */
function buildJsFiles(files, options, jsOpt) {
  const { action, runtime, pmType, type, packageManager, toolchain } = jsOpt;
  const name =
    options.name ||
    (options.type || options.action || options.toolchain
      ? type === "vite-plus"
        ? "test-vite-plus"
        : `test-${action || "project"}-${runtime}-${pmType}-${type}`
      : "consumer-project");

  const { scripts, devDependencies } = buildJsScriptsAndHtml(files, options, jsOpt);

  const packageJson = {
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
  buildJsLockfile(files, name, pmType, type, toolchain);

  if (runtime === "node" && (pmType === "npm" || pmType === "bun") && type === "basic") {
    files[".node-version"] = "24.19.0\n";
  }
}

/**
 * Generates Python files for a given scenario.
 * @param {Record<string, string>} files
 * @param {ConsumerProjectOptions} options
 * @param {ReturnType<typeof resolvePythonOptions>} pyOpt
 * @param {string} pyProjectName
 */
function buildPythonFiles(files, options, pyOpt, pyProjectName) {
  const { pythonPm, ruffVersion } = pyOpt;
  const type = options.type || "basic";

  const mainPy = `def main() -> None:\n    print("AREA44 consumer project Python entrypoint")\n\n\nif __name__ == "__main__":\n    main()\n`;
  files["main.py"] = mainPy;

  const pyDeps = [];
  if (ruffVersion) {
    pyDeps.push(`ruff==${ruffVersion}`);
  }

  const pyprojectToml =
    `[project]\nname = "${pyProjectName}"\nversion = "0.1.0"\n` +
    (pyDeps.length > 0 ? `dependencies = [\n${pyDeps.map((d) => `  "${d}",`).join("\n")}\n]\n\n` : "\n") +
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
 * Generates consumer project file contents as a map of filename -> string.
 * @param {ConsumerProjectOptions} [options]
 * @returns {Record<string, string>}
 */
export function generateConsumerProjectFiles(options = {}) {
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

  /** @type {Record<string, string>} */
  const files = {};

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
 * @param {string} targetDir
 * @param {ConsumerProjectOptions} [options]
 * @returns {string}
 */
export function createConsumerProject(targetDir, options = {}) {
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
        `Refusing to generate consumer project into non-empty directory '${resolvedTarget}'.`
      );
    }

    if (!options.overwrite) {
      const colliding = Object.keys(files).filter((filename) =>
        fs.existsSync(path.join(resolvedTarget, filename))
      );
      if (colliding.length > 0) {
        throw new Error(
          `Refusing to overwrite existing generated files in '${resolvedTarget}': ${colliding.join(", ")}. Pass 'overwrite: true' or '--overwrite' to allow.`
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
 * @param {string[]} args
 * @returns {{ targetDir: string|null, options: ConsumerProjectOptions }}
 */
function parseCliArgs(args) {
  /** @type {ConsumerProjectOptions} */
  const options = {};
  let targetDir = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--allow-non-empty") {
      options.allowNonEmpty = true;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
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

// CLI entrypoint when run directly
const currentScriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentScriptPath)) {
  const { targetDir, options } = parseCliArgs(process.argv.slice(2));

  if (!targetDir || targetDir.startsWith("-")) {
    console.error(
      "Error: Missing target directory argument. Usage: generate-consumer-project.js <target-directory> [options]"
    );
    process.exit(1);
  }

  createConsumerProject(targetDir, options);
  console.log(`Successfully generated consumer project in ${path.resolve(targetDir)}`);
}
