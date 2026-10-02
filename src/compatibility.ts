import fs from "node:fs";
import path from "node:path";

import { WorkflowError } from "./errors.js";

export type SupportedRuntime = "node" | "bun";
export type SupportedPackageManager = "npm" | "pnpm" | "bun";

export const SUPPORTED_ACTIONS = ["astro", "vite", "vite-plus", "lint-format"] as const;
export type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

export const SUPPORTED_FIXTURE_TYPES = ["basic", "minimal"] as const;
export type SupportedFixtureType = (typeof SUPPORTED_FIXTURE_TYPES)[number];

export interface CompatibilityStatus {
  supported: boolean;
  isDefault?: boolean;
  reason?: string;
}

export interface RuntimePackageManagerCompatibility {
  runtime: string;
  packageManager: string;
  status: CompatibilityStatus;
}

export interface MatrixCombinationEntry {
  runtime: SupportedRuntime;
  packageManager: SupportedPackageManager;
  supported: boolean;
  isDefault?: boolean;
  reason?: string;
}

export interface CanonicalCompatibilityModel {
  runtimes: readonly SupportedRuntime[];
  packageManagers: readonly SupportedPackageManager[];
  combinations: readonly MatrixCombinationEntry[];
}

export interface MatrixEntry {
  action: SupportedAction;
  runtime: SupportedRuntime;
  pm: SupportedPackageManager;
  type: SupportedFixtureType;
  verify_site?: boolean;
}

/**
 * Single canonical source of truth for runtime and package manager compatibility.
 */
export const CANONICAL_COMPATIBILITY_MODEL: CanonicalCompatibilityModel = {
  runtimes: ["node", "bun"] as const,
  packageManagers: ["npm", "pnpm", "bun"] as const,
  combinations: [
    { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
    { runtime: "node", packageManager: "pnpm", supported: true, isDefault: false },
    { runtime: "node", packageManager: "bun", supported: true, isDefault: false },
    { runtime: "bun", packageManager: "pnpm", supported: true, isDefault: false },
    { runtime: "bun", packageManager: "bun", supported: true, isDefault: false },
    {
      runtime: "bun",
      packageManager: "npm",
      supported: false,
      reason:
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager. Bun runtime requires Bun or pnpm package manager.",
    },
  ] as const,
};

export const SUPPORTED_RUNTIMES: readonly SupportedRuntime[] =
  CANONICAL_COMPATIBILITY_MODEL.runtimes;

export const SUPPORTED_PACKAGE_MANAGERS: readonly SupportedPackageManager[] =
  CANONICAL_COMPATIBILITY_MODEL.packageManagers;

export function isSupportedRuntime(runtime: string): runtime is SupportedRuntime {
  return (CANONICAL_COMPATIBILITY_MODEL.runtimes as readonly string[]).includes(runtime);
}

export function isSupportedPackageManager(pmName: string): pmName is SupportedPackageManager {
  return (CANONICAL_COMPATIBILITY_MODEL.packageManagers as readonly string[]).includes(pmName);
}

export function isSupportedAction(action: string): action is SupportedAction {
  return (SUPPORTED_ACTIONS as readonly string[]).includes(action);
}

export function isSupportedFixtureType(type: string): type is SupportedFixtureType {
  return (SUPPORTED_FIXTURE_TYPES as readonly string[]).includes(type);
}

/**
 * Evaluates whether a given runtime and package manager combination is supported according to the canonical compatibility model.
 */
export function getCombinationCompatibility(
  runtime: string,
  pmName: string,
): RuntimePackageManagerCompatibility {
  if (!isSupportedRuntime(runtime)) {
    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason: `Unsupported runtime "${runtime}". Supported runtimes are: ${SUPPORTED_RUNTIMES.join(", ")}.`,
      },
    };
  }

  if (!isSupportedPackageManager(pmName)) {
    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason: `Unsupported package manager "${pmName}". Supported package managers are: ${SUPPORTED_PACKAGE_MANAGERS.join(", ")}.`,
      },
    };
  }

  const combination = CANONICAL_COMPATIBILITY_MODEL.combinations.find(
    (c) => c.runtime === runtime && c.packageManager === pmName,
  );

  if (combination) {
    if (combination.supported) {
      return {
        runtime,
        packageManager: pmName,
        status: {
          supported: true,
          isDefault: Boolean(combination.isDefault),
        },
      };
    }

    return {
      runtime,
      packageManager: pmName,
      status: {
        supported: false,
        reason:
          combination.reason ||
          `Unsupported runtime and package manager combination: ${runtime} runtime does not support ${pmName} package manager.`,
      },
    };
  }

  return {
    runtime,
    packageManager: pmName,
    status: {
      supported: false,
      reason: `Unsupported runtime and package manager combination: ${runtime} runtime does not support ${pmName} package manager.`,
    },
  };
}

/**
 * Validates a runtime and package manager combination. Throws an Error if the combination is unsupported or invalid.
 */
export function validateRuntimePackageManagerCompatibility(
  runtime: string,
  pmName: string,
): RuntimePackageManagerCompatibility {
  if (!isSupportedRuntime(runtime)) {
    throw new WorkflowError(
      "UNSUPPORTED_RUNTIME_OR_PM",
      `Unsupported runtime "${runtime}". Supported runtimes are: ${SUPPORTED_RUNTIMES.join(", ")}.`,
      { resource: "runtime", value: runtime },
    );
  }

  if (!isSupportedPackageManager(pmName)) {
    throw new WorkflowError(
      "UNSUPPORTED_RUNTIME_OR_PM",
      `Unsupported package manager "${pmName}". Supported package managers are: ${SUPPORTED_PACKAGE_MANAGERS.join(", ")}.`,
      { resource: "packageManager", value: pmName },
    );
  }

  const compatibility = getCombinationCompatibility(runtime, pmName);
  if (!compatibility.status.supported) {
    throw new WorkflowError(
      "UNSUPPORTED_COMBINATION",
      compatibility.status.reason ||
        `Unsupported runtime and package manager combination: ${runtime} runtime does not support ${pmName} package manager.`,
      { resource: "compatibility", runtime, packageManager: pmName },
    );
  }
  return compatibility;
}

function ensureMatrixObject(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new WorkflowError("INVALID_INPUT", "CI matrix entry must be an object.", {
      stage: "matrix-validation",
    });
  }
  return entry as Record<string, unknown>;
}

function validateAllowedKeys(record: Record<string, unknown>): void {
  const allowedKeys = new Set(["action", "runtime", "pm", "type", "verify_site"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `CI matrix entry contains unrecognized field: "${key}"`,
        { stage: "matrix-validation", field: key },
      );
    }
  }
}

function validateRequiredStringFields(record: Record<string, unknown>): void {
  for (const field of ["action", "runtime", "pm", "type"] as const) {
    const val = record[field];
    if (val === undefined || val === null || val === "") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `CI matrix entry is missing required field: "${field}"`,
        { stage: "matrix-validation", field },
      );
    }
    if (typeof val !== "string") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `CI matrix entry field "${field}" must be a string.`,
        { stage: "matrix-validation", field },
      );
    }
  }
}

function validateFieldValues(action: string, runtime: string, pm: string, type: string): void {
  if (!isSupportedAction(action)) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `CI matrix entry contains unsupported action: ${action}`,
      {
        stage: "matrix-validation",
        action,
      },
    );
  }
  if (!isSupportedRuntime(runtime)) {
    throw new WorkflowError(
      "UNSUPPORTED_RUNTIME_OR_PM",
      `CI matrix entry contains unsupported runtime: ${runtime}`,
      { stage: "matrix-validation", runtime },
    );
  }
  if (!isSupportedPackageManager(pm)) {
    throw new WorkflowError(
      "UNSUPPORTED_RUNTIME_OR_PM",
      `CI matrix entry contains unsupported package manager: ${pm}`,
      { stage: "matrix-validation", packageManager: pm },
    );
  }
  if (!isSupportedFixtureType(type)) {
    throw new WorkflowError("INVALID_INPUT", `CI matrix entry contains unsupported type: ${type}`, {
      stage: "matrix-validation",
      type,
    });
  }
}

/**
 * Validates a single CI matrix entry structure against schema and compatibility rules.
 */
export function validateMatrixEntry(entry: unknown): MatrixEntry {
  const record = ensureMatrixObject(entry);
  validateAllowedKeys(record);
  validateRequiredStringFields(record);

  const rawAction = record.action as string;
  const rawRuntime = record.runtime as string;
  const rawPm = record.pm as string;
  const rawType = record.type as string;

  validateFieldValues(rawAction, rawRuntime, rawPm, rawType);

  const action = rawAction as SupportedAction;
  const runtime = rawRuntime as SupportedRuntime;
  const pm = rawPm as SupportedPackageManager;
  const type = rawType as SupportedFixtureType;

  if (record.verify_site !== undefined && typeof record.verify_site !== "boolean") {
    throw new WorkflowError(
      "INVALID_INPUT",
      `CI matrix entry field "verify_site" must be a boolean.`,
      { stage: "matrix-validation", field: "verify_site" },
    );
  }

  const comp = getCombinationCompatibility(runtime, pm);
  if (!comp.status.supported) {
    throw new WorkflowError(
      "UNSUPPORTED_COMBINATION",
      `CI matrix contains unsupported combination: ${action} (${runtime}, ${pm})`,
      { stage: "matrix-validation", action, runtime, packageManager: pm },
    );
  }

  return {
    action,
    runtime,
    pm,
    type,
    ...(record.verify_site !== undefined ? { verify_site: record.verify_site as boolean } : {}),
  };
}

/**
 * Derives the deterministic fixture path for a matrix entry.
 */
export function getFixturePath(
  entry: Pick<MatrixEntry, "action" | "runtime" | "pm" | "type">,
  rootDir: string = process.cwd(),
): string {
  return path.join(
    rootDir,
    "__tests__/fixtures",
    entry.action,
    entry.runtime,
    entry.pm,
    entry.type,
  );
}

/**
 * Validates that the fixture directory mapped to a matrix entry exists and contains valid structure.
 */
export function validateFixtureForMatrixEntry(
  entry: MatrixEntry,
  rootDir: string = process.cwd(),
): string {
  const fixtureDir = getFixturePath(entry, rootDir);
  if (!fs.existsSync(fixtureDir)) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Missing fixture directory for matrix entry '${entry.action} (${entry.runtime}, ${entry.pm}, ${entry.type})': ${fixtureDir}`,
      { stage: "fixture-validation", path: fixtureDir },
    );
  }
  const stat = fs.statSync(fixtureDir);
  if (!stat.isDirectory()) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Fixture path exists but is not a directory: ${fixtureDir}`,
      { stage: "fixture-validation", path: fixtureDir },
    );
  }
  const pkgJsonPath = path.join(fixtureDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Fixture directory is missing package.json: ${fixtureDir}`,
      { stage: "fixture-validation", path: pkgJsonPath },
    );
  }
  return fixtureDir;
}

function scanLeafDirs(currentDir: string, depth: number): string[] {
  const results: string[] = [];
  if (!fs.existsSync(currentDir)) return results;
  const items = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      const fullPath = path.join(currentDir, item.name);
      if (depth === 4) {
        results.push(path.normalize(fullPath));
      } else if (depth < 4) {
        results.push(...scanLeafDirs(fullPath, depth + 1));
      }
    }
  }
  return results;
}

/**
 * Computes orphan or unused fixture leaf directory relative paths in __tests__/fixtures.
 */
export function getOrphanFixturePaths(
  entries: MatrixEntry[],
  rootDir: string = process.cwd(),
): string[] {
  const fixturesBaseDir = path.join(rootDir, "__tests__/fixtures");
  if (!fs.existsSync(fixturesBaseDir)) {
    return [];
  }

  const expectedPaths = new Set(entries.map((e) => path.normalize(getFixturePath(e, rootDir))));
  const actualLeafDirs = scanLeafDirs(fixturesBaseDir, 1);
  const orphanPaths: string[] = [];

  for (const actualDir of actualLeafDirs) {
    if (!expectedPaths.has(actualDir)) {
      const relPath = path.relative(rootDir, actualDir);
      orphanPaths.push(path.normalize(relPath));
    }
  }

  return orphanPaths;
}

/**
 * Validates that no unused or orphaned fixture leaf directories exist in __tests__/fixtures.
 */
export function validateNoUnusedFixtures(
  entries: MatrixEntry[],
  rootDir: string = process.cwd(),
): void {
  const orphanPaths = getOrphanFixturePaths(entries, rootDir);
  for (const relPath of orphanPaths) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Unused fixture directory detected: ${relPath}`,
      {
        stage: "fixture-validation",
        path: relPath,
      },
    );
  }
}

/**
 * Validates an array of matrix entries for schema correctness, canonical combination coverage, and fixture structure.
 */
export function validateWorkflowMatrix(
  entries: unknown[],
  options: { rootDir?: string; checkFixtures?: boolean } = {},
): MatrixEntry[] {
  if (!Array.isArray(entries)) {
    throw new WorkflowError("INVALID_INPUT", "Workflow matrix entries must be an array.", {
      stage: "workflow-matrix-validation",
    });
  }

  const validatedEntries = entries.map((entry) => validateMatrixEntry(entry));

  const supportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
    (c) => c.supported,
  );

  for (const action of SUPPORTED_ACTIONS) {
    for (const comb of supportedCombinations) {
      const found = validatedEntries.some(
        (e) => e.action === action && e.runtime === comb.runtime && e.pm === comb.packageManager,
      );
      if (!found) {
        throw new WorkflowError(
          "UNSUPPORTED_COMBINATION",
          `CI matrix is missing supported combination: ${action} (${comb.runtime}, ${comb.packageManager})`,
          {
            stage: "workflow-matrix-validation",
            action,
            runtime: comb.runtime,
            packageManager: comb.packageManager,
          },
        );
      }
    }
  }

  const checkFixtures = options.checkFixtures ?? true;
  if (checkFixtures) {
    const rootDir = options.rootDir || process.cwd();
    for (const entry of validatedEntries) {
      validateFixtureForMatrixEntry(entry, rootDir);
    }
    validateNoUnusedFixtures(validatedEntries, rootDir);
  }

  return validatedEntries;
}
