import fs from "node:fs";
import path from "node:path";

import type { BreakingChange } from "./action-contract.js";

import { WorkflowError } from "./errors.js";

/**
 * Standard Semantic Versioning 2.0.0 regular expression.
 */
export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

export interface RepositoryVersion {
  version: string;
  source: "package.json";
}

export type VersionImpact = "patch" | "minor" | "major";

export interface ChangeDescriptor {
  /** Breaking changes reported by public action contract comparison. */
  breakingContractChanges?: BreakingChange[];
  /** Count of removed supported runtime/package-manager matrix combinations. */
  removedMatrixCombinations?: number;
  /** Indicates a required public input was added. */
  hasRequiredInputAddition?: boolean;
  /** Indicates an optional public input was changed to required. */
  hasOptionalToRequiredChange?: boolean;
  /** Indicates default value of a public action input was changed. */
  hasDefaultValueChange?: boolean;
  /** Indicates a public action input was removed. */
  hasRemovedPublicInput?: boolean;
  /** Indicates a public action output was removed. */
  hasRemovedPublicOutput?: boolean;
  /** Indicates an incompatible behavioral or contract change occurred. */
  hasIncompatibleBehaviorChange?: boolean;

  /** Count of newly added optional public action inputs. */
  addedOptionalInputs?: number;
  /** Count of newly added public action outputs. */
  addedPublicOutputs?: number;
  /** Count of newly added supported runtime/package-manager matrix combinations. */
  addedMatrixCombinations?: number;
  /** Count of newly added optional public inputs or public outputs. */
  newInputsOrOutputs?: number;
  /** Indicates backward-compatible new feature additions. */
  backwardCompatibleFeatures?: boolean;

  /** Indicates bug fixes, implementation adjustments, or non-functional changes. */
  isBugFixOrDocOnly?: boolean;
}

/**
 * Validates whether a version string complies with Semantic Versioning 2.0.0.
 */
export function isValidSemVer(version: string): boolean {
  if (typeof version !== "string" || version.trim() === "") {
    return false;
  }
  return SEMVER_REGEX.test(version.trim());
}

/**
 * Parses a Semantic Versioning 2.0.0 string into its components.
 * Throws a WorkflowError if the version format is invalid.
 */
export function parseSemVer(version: string): ParsedSemVer {
  if (typeof version !== "string" || version.trim() === "") {
    throw new WorkflowError("INVALID_INPUT", "Version string must be a non-empty string.", {
      stage: "version-parsing",
      value: String(version),
    });
  }

  const trimmed = version.trim();
  const match = trimmed.match(SEMVER_REGEX);
  if (!match) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid Semantic Version string "${trimmed}". Must follow SemVer 2.0.0 format (MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]).`,
      { stage: "version-parsing", version: trimmed },
    );
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] || undefined,
    build: match[5] || undefined,
  };
}

/**
 * Retrieves the single authoritative repository version from package.json.
 */
export function getRepositoryVersion(rootDir: string = process.cwd()): RepositoryVersion {
  const pkgPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Missing package.json file at repository root: ${pkgPath}`,
      { stage: "version-retrieval", path: pkgPath },
    );
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(pkgPath, "utf8");
  } catch (err) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Failed to read package.json file at: ${pkgPath}`,
      { stage: "version-retrieval", path: pkgPath, cause: err },
    );
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(rawContent) as Record<string, unknown>;
  } catch (err) {
    throw new WorkflowError("INVALID_INPUT", `Malformed JSON in package.json at: ${pkgPath}`, {
      stage: "version-retrieval",
      path: pkgPath,
      cause: err,
    });
  }

  if (pkg.version === undefined || pkg.version === null) {
    throw new WorkflowError("INVALID_INPUT", "package.json is missing required 'version' field.", {
      stage: "version-retrieval",
      path: pkgPath,
    });
  }

  if (typeof pkg.version !== "string") {
    throw new WorkflowError("INVALID_INPUT", "package.json 'version' field must be a string.", {
      stage: "version-retrieval",
      path: pkgPath,
      value: pkg.version,
    });
  }

  const versionStr = pkg.version.trim();
  if (!isValidSemVer(versionStr)) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `package.json 'version' field "${versionStr}" is not a valid Semantic Version.`,
      { stage: "version-retrieval", path: pkgPath, version: versionStr },
    );
  }

  return {
    version: versionStr,
    source: "package.json",
  };
}

/**
 * Validates the repository version against package-lock.json and documentation references.
 */
export function validateRepositoryVersion(rootDir: string = process.cwd()): {
  version: string;
  packageLockVersion?: string;
} {
  const { version: pkgVersion } = getRepositoryVersion(rootDir);

  const lockPath = path.join(rootDir, "package-lock.json");
  let lockVersion: string | undefined;

  if (fs.existsSync(lockPath)) {
    let lockData: Record<string, unknown>;
    try {
      const lockContent = fs.readFileSync(lockPath, "utf8");
      lockData = JSON.parse(lockContent) as Record<string, unknown>;
    } catch (err) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Malformed JSON in package-lock.json at: ${lockPath}`,
        {
          stage: "version-validation",
          path: lockPath,
          cause: err,
        },
      );
    }

    if (lockData.version === undefined || lockData.version === null) {
      throw new WorkflowError(
        "INVALID_INPUT",
        "package-lock.json is missing required 'version' field.",
        { stage: "version-validation", path: lockPath },
      );
    }

    if (typeof lockData.version !== "string") {
      throw new WorkflowError(
        "INVALID_INPUT",
        "package-lock.json 'version' field must be a string.",
        { stage: "version-validation", path: lockPath, value: lockData.version },
      );
    }

    const trimmedLockVersion = lockData.version.trim();
    if (!isValidSemVer(trimmedLockVersion)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `package-lock.json 'version' field "${trimmedLockVersion}" is not a valid Semantic Version.`,
        { stage: "version-validation", path: lockPath, version: trimmedLockVersion },
      );
    }

    lockVersion = trimmedLockVersion;

    if (lockVersion !== pkgVersion) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Conflicting version declarations: package.json has "${pkgVersion}" but package-lock.json has "${lockVersion}".`,
        {
          stage: "version-validation",
          packageVersion: pkgVersion,
          packageLockVersion: lockVersion,
        },
      );
    }
  }

  const compatPath = path.join(rootDir, "COMPATIBILITY.md");
  if (fs.existsSync(compatPath)) {
    const compatContent = fs.readFileSync(compatPath, "utf8");
    const mentionsPkgJson = compatContent.includes("package.json");
    const mentionsAuthoritative =
      compatContent.includes("authoritative") || compatContent.includes("Authoritative");

    if (!mentionsPkgJson || !mentionsAuthoritative) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        "COMPATIBILITY.md must document package.json as the authoritative version source.",
        { stage: "version-validation", path: compatPath },
      );
    }
  }

  return {
    version: pkgVersion,
    packageLockVersion: lockVersion,
  };
}

/**
 * Deterministically classifies the semantic version impact (patch, minor, major) based on change criteria.
 */
export function classifyChangeImpact(change: ChangeDescriptor): VersionImpact {
  if (
    (change.breakingContractChanges && change.breakingContractChanges.length > 0) ||
    (change.removedMatrixCombinations && change.removedMatrixCombinations > 0) ||
    change.hasRequiredInputAddition ||
    change.hasOptionalToRequiredChange ||
    change.hasDefaultValueChange ||
    change.hasRemovedPublicInput ||
    change.hasRemovedPublicOutput ||
    change.hasIncompatibleBehaviorChange
  ) {
    return "major";
  }

  if (
    (change.addedMatrixCombinations && change.addedMatrixCombinations > 0) ||
    (change.addedOptionalInputs && change.addedOptionalInputs > 0) ||
    (change.addedPublicOutputs && change.addedPublicOutputs > 0) ||
    (change.newInputsOrOutputs && change.newInputsOrOutputs > 0) ||
    change.backwardCompatibleFeatures
  ) {
    return "minor";
  }

  return "patch";
}

/**
 * Command-line entrypoint for verifying repository versioning contract.
 * Exits with code 1 if validation fails.
 */
export function runVersionVerification(rootDir: string = process.cwd()): void {
  try {
    const result = validateRepositoryVersion(rootDir);
    console.log(
      `Verified repository versioning contract: package.json version "${result.version}" is valid SemVer and synchronized${result.packageLockVersion ? ` with package-lock.json (${result.packageLockVersion})` : ""}.`,
    );
  } catch (error) {
    console.error("Repository Version Verification Failed:");
    if (error instanceof WorkflowError) {
      console.error(`  [${error.code}] ${error.message}`);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ${msg}`);
    }
    process.exit(1);
  }
}
