import fs from "node:fs";
import path from "node:path";

import config from "../vite.config";

export interface ArtifactMapping {
  name: string;
  sourcePath: string;
  outputPath: string;
}

export interface VerificationResult {
  valid: boolean;
  expectedArtifacts: ArtifactMapping[];
  missingArtifacts: string[];
  unexpectedArtifacts: string[];
  errors: string[];
}

/**
 * Programmatically derives the expected generated artifacts from vite.config.ts.
 */
export function getExpectedArtifacts(rootDir: string = process.cwd()): ArtifactMapping[] {
  const viteConfigPath = path.join(rootDir, "vite.config.ts");
  if (!fs.existsSync(viteConfigPath)) {
    throw new Error(`Configuration file not found: ${viteConfigPath}`);
  }

  const pack = (
    config as { pack?: Array<{ entry: Record<string, string>; outDir?: string; format?: string }> }
  ).pack;

  if (Array.isArray(pack) && pack.length > 0) {
    return pack.flatMap((item) => {
      const outDir = item.outDir || "dist";
      const ext = item.format === "cjs" ? ".cjs" : ".mjs";
      return Object.entries(item.entry).map(([name, sourcePath]) => ({
        name,
        sourcePath: path.normalize(sourcePath),
        outputPath: path.normalize(path.join(outDir, `${name}${ext}`)),
      }));
    });
  }

  const content = fs.readFileSync(viteConfigPath, "utf8");
  const packMatch = content.match(/pack:\s*\[([\s\S]*?)\]\.map/);
  if (packMatch && packMatch[1]) {
    const names = Array.from(packMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    return names.map((name) => ({
      name,
      sourcePath: path.normalize(`src/${name}.ts`),
      outputPath: path.normalize(`dist/${name}.mjs`),
    }));
  }

  throw new Error("Unable to derive pack entries from vite.config.ts");
}

/**
 * Verifies that generated artifacts exist, match expected config, and dist/ has no unexpected files.
 */
export function verifyArtifactIntegrity(rootDir: string = process.cwd()): VerificationResult {
  const expectedArtifacts = getExpectedArtifacts(rootDir);
  const missingArtifacts: string[] = [];
  const errors: string[] = [];

  for (const artifact of expectedArtifacts) {
    const fullOutputPath = path.join(rootDir, artifact.outputPath);
    const fullSourcePath = path.join(rootDir, artifact.sourcePath);

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
  const unexpectedArtifacts: string[] = [];

  if (fs.existsSync(distDir)) {
    const actualFiles = fs.readdirSync(distDir);
    const expectedFileNames = new Set(expectedArtifacts.map((a) => path.basename(a.outputPath)));

    for (const file of actualFiles) {
      if (!expectedFileNames.has(file)) {
        unexpectedArtifacts.push(path.join("dist", file));
      }
    }
  } else {
    errors.push("dist/ directory does not exist");
  }

  const valid =
    missingArtifacts.length === 0 && unexpectedArtifacts.length === 0 && errors.length === 0;

  return {
    valid,
    expectedArtifacts,
    missingArtifacts,
    unexpectedArtifacts,
    errors,
  };
}
