import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

import { parseActionContract, PUBLIC_ACTIONS, PublicActionName } from "./action-contract.js";
import { getExpectedArtifacts, verifyArtifactIntegrity } from "./artifact-integrity.js";
import { validateWorkflowMatrix } from "./compatibility.js";
import { validateRepositoryVersion } from "./versioning.js";

export interface HealthVerificationOptions {
  checkGitStatus?: boolean;
}

export interface HealthVerificationResult {
  valid: boolean;
  errors: string[];
  publicActions: string[];
  artifactsVerified: boolean;
  orphanDocs: string[];
  orphanFixtures: string[];
}

const REQUIRED_ROOT_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "AGENTS.md",
  "COMPATIBILITY.md",
  "README.md",
  ".github/workflows/ci.yml",
  ".github/workflows/test-actions.yml",
] as const;

const REQUIRED_CI_COMMANDS = [
  "npm test",
  "npm run build",
  "npm run verify:artifacts",
  "npm run verify:version",
  "npm run verify:upgrade",
  "npm run verify:docs",
  "npm run verify:health",
] as const;

function verifyRootFiles(rootDir: string, errors: string[]): void {
  for (const fileName of REQUIRED_ROOT_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing required root repository file: ${fileName}`);
    }
  }
}

function verifyVersionSynchronization(rootDir: string, errors: string[]): void {
  try {
    validateRepositoryVersion(rootDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Version synchronization failure: ${msg}`);
  }
}

function scanForUnexpectedActions(rootDir: string, errors: string[]): void {
  if (!fs.existsSync(rootDir)) return;

  const knownActionsSet = new Set<string>(PUBLIC_ACTIONS);
  const items = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const item of items) {
    if (item.isDirectory()) {
      const dirName = item.name;
      if (
        dirName.startsWith(".") ||
        dirName === "node_modules" ||
        dirName === "src" ||
        dirName === "dist" ||
        dirName === "docs" ||
        dirName === "__tests__"
      ) {
        continue;
      }

      const actionYml = path.join(rootDir, dirName, "action.yml");
      const actionYaml = path.join(rootDir, dirName, "action.yaml");
      if (fs.existsSync(actionYml) || fs.existsSync(actionYaml)) {
        if (!knownActionsSet.has(dirName)) {
          errors.push(
            `Unexpected public action directory found in repository root: '${dirName}' is not defined in PUBLIC_ACTIONS.`,
          );
        }
      }
    }
  }
}

function extractReferencedArtifacts(actionYmlPath: string): string[] {
  if (!fs.existsSync(actionYmlPath)) return [];

  const content = fs.readFileSync(actionYmlPath, "utf8");
  const matches = content.matchAll(/(?:dist\/|\$ACTION_PATH\/\.\.\/dist\/)([a-zA-Z0-9_-]+\.mjs)/g);
  const artifacts: string[] = [];
  for (const m of matches) {
    if (m[1]) {
      artifacts.push(`dist/${m[1]}`);
    }
  }
  return Array.from(new Set(artifacts));
}

function verifyPublicAction(actionName: PublicActionName, rootDir: string, errors: string[]): void {
  const actionDir = path.join(rootDir, actionName);
  if (!fs.existsSync(actionDir) || !fs.statSync(actionDir).isDirectory()) {
    errors.push(`Missing required public action directory: ${actionName}`);
    return;
  }

  const actionYmlPath = path.join(actionDir, "action.yml");
  const actionYamlPath = path.join(actionDir, "action.yaml");
  const ymlPath = fs.existsSync(actionYmlPath)
    ? actionYmlPath
    : fs.existsSync(actionYamlPath)
      ? actionYamlPath
      : undefined;

  if (!ymlPath) {
    errors.push(`Public action '${actionName}' is missing action.yml or action.yaml file.`);
  }

  const readmePath = path.join(actionDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    errors.push(`Public action '${actionName}' is missing README.md file.`);
  }

  if (ymlPath) {
    try {
      parseActionContract(actionName, rootDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Invalid action contract for '${actionName}': ${msg}`);
    }

    const referencedArtifacts = extractReferencedArtifacts(ymlPath);
    let expectedArtifactPaths: Set<string>;
    try {
      const expected = getExpectedArtifacts(rootDir);
      expectedArtifactPaths = new Set(expected.map((a) => path.normalize(a.outputPath)));
    } catch {
      expectedArtifactPaths = new Set();
    }

    for (const refArtifact of referencedArtifacts) {
      const normalizedRef = path.normalize(refArtifact);
      const fullPath = path.join(rootDir, normalizedRef);

      if (!fs.existsSync(fullPath)) {
        errors.push(
          `Public action '${actionName}' references non-existent artifact file: ${refArtifact}`,
        );
      }

      if (expectedArtifactPaths.size > 0 && !expectedArtifactPaths.has(normalizedRef)) {
        errors.push(
          `Public action '${actionName}' references unexpected artifact file '${refArtifact}' not defined in build pack configuration.`,
        );
      }
    }
  }
}

function verifyPublicActionStructures(rootDir: string, errors: string[]): string[] {
  scanForUnexpectedActions(rootDir, errors);

  const verifiedActions: string[] = [];
  for (const actionName of PUBLIC_ACTIONS) {
    verifyPublicAction(actionName, rootDir, errors);
    verifiedActions.push(actionName);
  }

  return verifiedActions;
}

function verifyOrphanDocs(rootDir: string, errors: string[]): string[] {
  const docsDir = path.join(rootDir, "docs");
  const orphanDocs: string[] = [];

  if (!fs.existsSync(docsDir)) return orphanDocs;

  const readmePath = path.join(rootDir, "README.md");
  const compatibilityPath = path.join(rootDir, "COMPATIBILITY.md");

  const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
  const compatContent = fs.existsSync(compatibilityPath)
    ? fs.readFileSync(compatibilityPath, "utf8")
    : "";

  const combinedDocsText = `${readmeContent}\n${compatContent}`;
  const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));

  for (const docFile of docFiles) {
    const fileRefPattern = new RegExp(`docs/${docFile}|\\./docs/${docFile}|${docFile}`, "i");
    if (!fileRefPattern.test(combinedDocsText)) {
      orphanDocs.push(docFile);
      errors.push(
        `Orphan documentation file detected in docs/: '${docFile}' is not linked in README.md or COMPATIBILITY.md.`,
      );
    }
  }

  return orphanDocs;
}

function verifyOrphanFixturesAndMatrix(rootDir: string, errors: string[]): string[] {
  const orphanFixtures: string[] = [];
  const testActionsWorkflow = path.join(rootDir, ".github/workflows/test-actions.yml");

  if (!fs.existsSync(testActionsWorkflow)) {
    return orphanFixtures;
  }

  try {
    const yamlText = fs.readFileSync(testActionsWorkflow, "utf8");
    const doc = parseDocument(yamlText);
    const data = doc.toJS() as any;

    const includeEntries = data?.jobs?.["test-action"]?.strategy?.matrix?.include || [];

    validateWorkflowMatrix(includeEntries, { rootDir, checkFixtures: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`CI test matrix / fixture verification failed: ${msg}`);
  }

  return orphanFixtures;
}

function verifyCiWorkflowInvariants(rootDir: string, errors: string[]): void {
  const ciPath = path.join(rootDir, ".github/workflows/ci.yml");
  if (!fs.existsSync(ciPath)) {
    return;
  }

  const ciContent = fs.readFileSync(ciPath, "utf8");

  for (const cmd of REQUIRED_CI_COMMANDS) {
    if (!ciContent.includes(cmd)) {
      errors.push(
        `CI workflow .github/workflows/ci.yml is missing required verification command: '${cmd}'`,
      );
    }
  }
}

function verifyArtifactIntegrityCheck(
  rootDir: string,
  options: HealthVerificationOptions,
  errors: string[],
): boolean {
  try {
    const checkGit = options.checkGitStatus ?? true;
    const result = verifyArtifactIntegrity(rootDir, { checkGitStatus: checkGit });
    if (!result.valid) {
      if (result.errors.length > 0) {
        errors.push(...result.errors);
      } else {
        errors.push("Artifact integrity verification failed.");
      }
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Artifact integrity verification error: ${msg}`);
    return false;
  }
}

/**
 * Programmatically checks all machine-verifiable repository health invariants.
 */
export function verifyRepositoryHealth(
  rootDir: string = process.cwd(),
  options: HealthVerificationOptions = {},
): HealthVerificationResult {
  const errors: string[] = [];

  verifyRootFiles(rootDir, errors);
  verifyVersionSynchronization(rootDir, errors);
  const publicActions = verifyPublicActionStructures(rootDir, errors);
  const orphanDocs = verifyOrphanDocs(rootDir, errors);
  const orphanFixtures = verifyOrphanFixturesAndMatrix(rootDir, errors);
  verifyCiWorkflowInvariants(rootDir, errors);
  const artifactsVerified = verifyArtifactIntegrityCheck(rootDir, options, errors);

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    publicActions,
    artifactsVerified,
    orphanDocs,
    orphanFixtures,
  };
}

/**
 * Command-line entrypoint for running repository health verification.
 */
export function runHealthVerification(
  rootDir: string = process.cwd(),
  options: HealthVerificationOptions = {},
): void {
  const result = verifyRepositoryHealth(rootDir, options);

  if (!result.valid) {
    console.error("Repository Health Verification Failed:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    "Verified repository health: all public action structures, repository invariants, artifacts, documentation, and configuration files are synchronized.",
  );
}
