import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ArtifactMapping {
  name: string;
  sourcePath: string;
  outputPath: string;
}

export interface VerificationOptions {
  checkGitStatus?: boolean;
  executeBuild?: boolean;
}

export interface VerificationResult {
  valid: boolean;
  expectedArtifacts: ArtifactMapping[];
  missingArtifacts: string[];
  unexpectedArtifacts: string[];
  staleArtifacts: string[];
  errors: string[];
}

/**
 * Parses the `pack` build entry configuration directly from vite.config.ts content.
 */
export function parseViteConfigPack(content: string): ArtifactMapping[] {
  const mapMatch = content.match(
    /pack:\s*\[([\s\S]*?)\]\.map\s*\(\s*\(?([a-zA-Z0-9_]+)\)?\s*=>\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\)/,
  );
  if (mapMatch) {
    const namesRaw = mapMatch[1];
    const nameVar = mapMatch[2];
    const bodyObj = mapMatch[3];

    const names = Array.from(namesRaw.matchAll(/["\x27]([^"\x27]+)["\x27]/g)).map((m) => m[1]);

    const outDirMatch = bodyObj.match(/outDir:\s*["\x27]([^"\x27]+)["\x27]/);
    const outDir = outDirMatch ? outDirMatch[1] : "dist";

    const formatMatch = bodyObj.match(/format:\s*["\x27]([^"\x27]+)["\x27]/);
    const format = formatMatch ? formatMatch[1] : "esm";
    const ext = format === "cjs" ? ".cjs" : ".mjs";

    const entryTemplateMatch = bodyObj.match(
      /entry:\s*\{\s*\[?\s*([a-zA-Z0-9_]+)\s*\]?:\s*`([^`]+)`|\s*["\x27]([^"\x27]+)["\x27]\s*\}/,
    );

    return names.map((name) => {
      let sourcePath = `src/${name}.ts`;
      if (entryTemplateMatch && entryTemplateMatch[2]) {
        sourcePath = entryTemplateMatch[2].replace(new RegExp(`\\$\\{${nameVar}\\}`, "g"), name);
      }
      return {
        name,
        sourcePath: path.normalize(sourcePath),
        outputPath: path.normalize(`${outDir}/${name}${ext}`),
      };
    });
  }

  const staticPackMatch = content.match(/pack:\s*\[([\s\S]*?)\]/);
  if (staticPackMatch) {
    const itemsRaw = staticPackMatch[1];
    const itemMatches = Array.from(
      itemsRaw.matchAll(
        /\{\s*entry:\s*\{([^}]+)\}(?:[\s\S]*?outDir:\s*["\x27]([^"\x27]+)["\x27])?(?:[\s\S]*?format:\s*["\x27]([^"\x27]+)["\x27])?/g,
      ),
    );
    if (itemMatches.length > 0) {
      return itemMatches.flatMap((m) => {
        const entryBody = m[1];
        const outDir = m[2] || "dist";
        const format = m[3] || "esm";
        const ext = format === "cjs" ? ".cjs" : ".mjs";

        const entries = Array.from(
          entryBody.matchAll(
            /(?:["\x27]?([a-zA-Z0-9_-]+)["\x27]?|\[["\x27]?([a-zA-Z0-9_-]+)["\x27]?\])\s*:\s*["\x27`]([^"\x27`]+)["\x27`]/g,
          ),
        );
        return entries.map((e) => ({
          name: e[1] || e[2],
          sourcePath: path.normalize(e[3]),
          outputPath: path.normalize(`${outDir}/${e[1] || e[2]}${ext}`),
        }));
      });
    }
  }

  throw new Error("Unable to parse pack configuration from vite.config.ts");
}

/**
 * Programmatically derives expected build artifacts from the rootDir's vite.config.ts.
 */
export function getExpectedArtifacts(rootDir: string = process.cwd()): ArtifactMapping[] {
  const viteConfigPath = path.join(rootDir, "vite.config.ts");
  if (!fs.existsSync(viteConfigPath)) {
    throw new Error(`Configuration file not found: ${viteConfigPath}`);
  }

  const content = fs.readFileSync(viteConfigPath, "utf8");
  return parseViteConfigPack(content);
}

/**
 * Single, unified verifier for generated artifact integrity.
 */
export function verifyArtifactIntegrity(
  rootDir: string = process.cwd(),
  options: VerificationOptions = {},
): VerificationResult {
  const checkBuild = options.executeBuild ?? false;
  if (checkBuild) {
    try {
      execSync("npm run build", {
        cwd: rootDir,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      // Build failure will be reflected in output verification below
    }
  }

  const expectedArtifacts = getExpectedArtifacts(rootDir);
  const missingArtifacts: string[] = [];
  const unexpectedArtifacts: string[] = [];
  const staleArtifacts: string[] = [];
  const errors: string[] = [];

  for (const artifact of expectedArtifacts) {
    const fullSourcePath = path.join(rootDir, artifact.sourcePath);
    const fullOutputPath = path.join(rootDir, artifact.outputPath);

    if (!fs.existsSync(fullSourcePath)) {
      errors.push(`Source file missing for artifact '${artifact.name}': ${artifact.sourcePath}`);
    }

    if (!fs.existsSync(fullOutputPath)) {
      missingArtifacts.push(artifact.outputPath);
    } else {
      const stat = fs.statSync(fullOutputPath);
      if (stat.size === 0) {
        errors.push(`Generated artifact is empty: ${artifact.outputPath}`);
      }
    }
  }

  const distDir = path.join(rootDir, "dist");
  if (fs.existsSync(distDir)) {
    const actualFiles = fs.readdirSync(distDir);
    const expectedFileNames = new Set(expectedArtifacts.map((a) => path.basename(a.outputPath)));

    for (const file of actualFiles) {
      if (!expectedFileNames.has(file)) {
        unexpectedArtifacts.push(path.normalize(path.join("dist", file)));
      }
    }
  } else {
    errors.push("dist/ directory does not exist");
  }

  const checkGit = options.checkGitStatus ?? true;
  if (checkGit) {
    try {
      const gitDir = path.join(rootDir, ".git");
      if (fs.existsSync(gitDir) || fs.existsSync(distDir)) {
        const statusOutput = execSync("git status --porcelain -- dist/", {
          cwd: rootDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();

        if (statusOutput) {
          const lines = statusOutput.split("\n");
          for (const line of lines) {
            const file = line.trim().split(/\s+/).slice(1).join(" ");
            if (file) {
              staleArtifacts.push(path.normalize(file));
            }
          }
        }
      }
    } catch {
      // Ignore git command failure if not in git repo
    }
  }

  const valid =
    missingArtifacts.length === 0 &&
    unexpectedArtifacts.length === 0 &&
    staleArtifacts.length === 0 &&
    errors.length === 0;

  return {
    valid,
    expectedArtifacts,
    missingArtifacts,
    unexpectedArtifacts,
    staleArtifacts,
    errors,
  };
}

/**
 * Command-line entrypoint for running artifact verification.
 */
export function runArtifactVerification(rootDir: string = process.cwd()): void {
  const result = verifyArtifactIntegrity(rootDir, { executeBuild: true, checkGitStatus: true });

  if (!result.valid) {
    console.error("Artifact Integrity Verification Failed:");
    if (result.missingArtifacts.length > 0) {
      console.error("  Missing Artifacts:");
      result.missingArtifacts.forEach((item) => console.error(`    - ${item}`));
    }
    if (result.unexpectedArtifacts.length > 0) {
      console.error("  Unexpected Files in dist/:");
      result.unexpectedArtifacts.forEach((item) => console.error(`    - ${item}`));
    }
    if (result.staleArtifacts.length > 0) {
      console.error("  Stale / Out-of-sync Artifacts in dist/:");
      result.staleArtifacts.forEach((item) => console.error(`    - ${item}`));
    }
    if (result.errors.length > 0) {
      console.error("  Errors:");
      result.errors.forEach((item) => console.error(`    - ${item}`));
    }
    console.error("\nPlease run 'npm run build' locally and commit the updated dist/ files.");
    process.exit(1);
  }

  const fileList = result.expectedArtifacts.map((a) => a.outputPath).join(", ");
  console.log(
    `Verified generated artifact integrity: all expected artifacts (${fileList}) exist and dist/ is synchronized.`,
  );
}
