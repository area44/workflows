#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} ConsumerProjectOptions
 * @property {string} [name]
 * @property {string} [packageManager]
 * @property {string} [pythonVersion]
 * @property {string} [ruffVersion]
 * @property {string} [markerContent]
 * @property {boolean} [allowNonEmpty]
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
  if (fs.existsSync(targetDir)) {
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Target path '${targetDir}' exists and is not a directory.`);
    }
    if (!options.allowNonEmpty) {
      const existing = fs.readdirSync(targetDir);
      if (existing.length > 0) {
        throw new Error(`Refusing to generate consumer project into non-empty directory '${targetDir}'.`);
      }
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files = generateConsumerProjectFiles(options);
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(targetDir, filename), content, "utf8");
  }

  return targetDir;
}

// CLI entrypoint when run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  const targetDir = process.argv[2] || process.cwd();
  createConsumerProject(targetDir, { allowNonEmpty: true });
  console.log(`Successfully generated consumer project in ${path.resolve(targetDir)}`);
}
