import fs from "node:fs";
import path from "node:path";

export interface ConsumerProjectOptions {
  name?: string;
  packageManager?: string;
  pythonVersion?: string;
  ruffVersion?: string;
  markerContent?: string;
}

export function generateConsumerProjectFiles(
  options: ConsumerProjectOptions = {},
): Record<string, string> {
  const name = options.name ?? "consumer-project";
  const packageManager = options.packageManager ?? "npm@10.8.2";
  const ruffVersion = options.ruffVersion ?? "0.17.2";
  const markerContent =
    options.markerContent ?? "AREA44 Workflows Consumer Project";

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

export function createConsumerProject(
  targetDir: string,
  options: ConsumerProjectOptions = {},
): string {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files = generateConsumerProjectFiles(options);
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(targetDir, filename), content, "utf8");
  }

  return targetDir;
}
