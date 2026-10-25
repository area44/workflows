#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {Object} ConsumerProjectOptions
 * @property {string} [name]
 * @property {string} [packageManager]
 * @property {string} [pythonVersion]
 * @property {string} [ruffVersion]
 * @property {string} [markerContent]
 * @property {boolean} [allowNonEmpty]
 * @property {boolean} [overwrite]
 */

/**
 * Generates consumer project file contents as a map of filename -> string.
 * @param {ConsumerProjectOptions} [options]
 * @returns {Record<string, string>}
 */
export function generateConsumerProjectFiles(options = {}) {
  const name = options.name || "consumer-project";
  const packageManager = options.packageManager || "npm@10.8.2";
  const ruffVersion = options.ruffVersion || "0.17.2";
  const markerContent = options.markerContent || "AREA44 Workflows Consumer Project";

  const packageJson = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "mkdir -p dist && cp index.html dist/index.html",
      lint: "node -e \"console.log('Linting JS...')\"",
      format: "node -e \"console.log('Formatting JS...')\"",
    },
    packageManager,
  };

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

  const pyprojectToml = `[project]
name = "consumer-app"
version = "0.1.0"
dependencies = [
  "ruff==${ruffVersion}",
]

[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["*"]

[tool.ruff]
line-length = 88
`;

  const requirementsTxt = `ruff==${ruffVersion}\n`;

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Consumer Project</title>
  </head>
  <body>
    <h1>${markerContent}</h1>
  </body>
</html>
`;

  const mainPy = `def main() -> None:
    print("AREA44 consumer project Python entrypoint")


if __name__ == "__main__":
    main()
`;

  return {
    "package.json": JSON.stringify(packageJson, null, 2) + "\n",
    "package-lock.json": JSON.stringify(packageLockJson, null, 2) + "\n",
    "pyproject.toml": pyprojectToml,
    "requirements.txt": requirementsTxt,
    "index.html": indexHtml,
    "main.py": mainPy,
  };
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
    fs.writeFileSync(path.join(resolvedTarget, filename), content, "utf8");
  }

  return resolvedTarget;
}

// CLI entrypoint when run directly
const currentScriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentScriptPath)) {
  const targetDir = process.argv[2];
  if (!targetDir || targetDir.startsWith("-")) {
    console.error(
      "Error: Missing target directory argument. Usage: generate-consumer-project.js <target-directory> [--allow-non-empty] [--overwrite]"
    );
    process.exit(1);
  }

  const allowNonEmpty = process.argv.includes("--allow-non-empty");
  const overwrite = process.argv.includes("--overwrite");
  createConsumerProject(targetDir, { allowNonEmpty, overwrite });
  console.log(`Successfully generated consumer project in ${path.resolve(targetDir)}`);
}
