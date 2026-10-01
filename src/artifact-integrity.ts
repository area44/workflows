import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { WorkflowError } from "./errors";

export interface ArtifactMapping {
  name: string;
  sourcePath: string;
  outputPath: string;
}

export interface VerificationOptions {
  checkGitStatus?: boolean;
  executeBuild?: boolean;
  buildFn?: () => void;
}

export interface VerificationResult {
  valid: boolean;
  buildFailed: boolean;
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

  throw new WorkflowError(
    "MISSING_CONFIGURATION",
    "Unable to parse pack configuration from vite.config.ts",
    { stage: "artifact-integrity", path: "vite.config.ts" },
  );
}

/**
 * Programmatically derives expected build artifacts from the rootDir's vite.config.ts.
 */
export function getExpectedArtifacts(rootDir: string = process.cwd()): ArtifactMapping[] {
  const viteConfigPath = path.join(rootDir, "vite.config.ts");
  if (!fs.existsSync(viteConfigPath)) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Configuration file not found: ${viteConfigPath}`,
      { stage: "artifact-integrity", path: viteConfigPath },
    );
  }

  const content = fs.readFileSync(viteConfigPath, "utf8");
  return parseViteConfigPack(content);
}

function executeVerificationBuild(
  options: VerificationOptions,
  rootDir: string,
): { buildFailed: boolean; buildError?: string } {
  if (!options.executeBuild) {
    return { buildFailed: false };
  }

  try {
    if (options.buildFn) {
      options.buildFn();
    } else {
      execSync("npm run build", {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    return { buildFailed: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      buildFailed: true,
      buildError: `Build command failed during artifact verification: ${msg}`,
    };
  }
}

function checkMissingAndEmptyArtifacts(
  expectedArtifacts: ArtifactMapping[],
  rootDir: string,
): { missingArtifacts: string[]; errors: string[] } {
  const missingArtifacts: string[] = [];
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

  return { missingArtifacts, errors };
}

function checkUnexpectedDistFiles(
  expectedArtifacts: ArtifactMapping[],
  rootDir: string,
): { unexpectedArtifacts: string[]; distError?: string } {
  const distDir = path.join(rootDir, "dist");
  const unexpectedArtifacts: string[] = [];

  if (!fs.existsSync(distDir)) {
    return { unexpectedArtifacts: [], distError: "dist/ directory does not exist" };
  }

  const actualFiles = fs.readdirSync(distDir);
  const expectedFileNames = new Set(expectedArtifacts.map((a) => path.basename(a.outputPath)));

  for (const file of actualFiles) {
    if (!expectedFileNames.has(file)) {
      unexpectedArtifacts.push(path.normalize(path.join("dist", file)));
    }
  }

  return { unexpectedArtifacts };
}

function checkGitStatusDrift(rootDir: string): string[] {
  const distDir = path.join(rootDir, "dist");
  const gitDir = path.join(rootDir, ".git");
  const staleArtifacts: string[] = [];

  if (!fs.existsSync(gitDir) && !fs.existsSync(distDir)) {
    return staleArtifacts;
  }

  try {
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
  } catch {
    // Ignore git command failure
  }

  return staleArtifacts;
}

/**
 * Single, unified verifier for generated artifact integrity.
 */
export function verifyArtifactIntegrity(
  rootDir: string = process.cwd(),
  options: VerificationOptions = {},
): VerificationResult {
  const { buildFailed, buildError } = executeVerificationBuild(options, rootDir);
  const errors: string[] = buildError ? [buildError] : [];

  const expectedArtifacts = getExpectedArtifacts(rootDir);

  const { missingArtifacts, errors: existenceErrors } = checkMissingAndEmptyArtifacts(
    expectedArtifacts,
    rootDir,
  );
  errors.push(...existenceErrors);

  const { unexpectedArtifacts, distError } = checkUnexpectedDistFiles(expectedArtifacts, rootDir);
  if (distError) {
    errors.push(distError);
  }

  const checkGit = options.checkGitStatus ?? true;
  const staleArtifacts = checkGit ? checkGitStatusDrift(rootDir) : [];
  if (staleArtifacts.length > 0) {
    for (const staleFile of staleArtifacts) {
      errors.push(`Generated artifact '${staleFile}' is stale / out of sync with source code.`);
    }
  }

  const valid =
    !buildFailed &&
    missingArtifacts.length === 0 &&
    unexpectedArtifacts.length === 0 &&
    staleArtifacts.length === 0 &&
    errors.length === 0;

  return {
    valid,
    buildFailed,
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
    if (result.buildFailed) {
      console.error("  Build Failure Detected during verification.");
    }
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
