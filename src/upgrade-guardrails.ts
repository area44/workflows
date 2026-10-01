import { execSync } from "node:child_process";
import vm from "node:vm";

import type { PublicActionContract, PublicActionName } from "./action-contract.js";
import type { CanonicalCompatibilityModel, MatrixCombinationEntry } from "./compatibility.ts";

import {
  detectBreakingChanges,
  parseActionContractYaml,
  PUBLIC_ACTIONS,
  validateAllPublicActionContracts,
} from "./action-contract.js";
import { CANONICAL_COMPATIBILITY_MODEL } from "./compatibility.js";
import { WorkflowError } from "./errors.js";
import {
  ChangeDescriptor,
  classifyChangeImpact,
  getRepositoryVersion,
  parseSemVer,
  VersionImpact,
} from "./versioning.js";

export interface BaselineContracts {
  version: string;
  publicActions: Record<PublicActionName, PublicActionContract>;
  compatibilityModel: CanonicalCompatibilityModel;
}

export interface TargetContracts {
  version: string;
  publicActions: Record<PublicActionName, PublicActionContract>;
  compatibilityModel: CanonicalCompatibilityModel;
}

export interface UpgradeGuardrailOptions {
  baseRef?: string;
  rootDir?: string;
  baselineContracts?: BaselineContracts;
}

export interface UpgradeGuardrailResult {
  valid: boolean;
  baseRef?: string;
  baselineVersion: string;
  targetVersion: string;
  requiredImpact: VersionImpact;
  changeDescriptor: ChangeDescriptor;
  violations: string[];
}

/**
 * Validates whether target semver satisfies required impact relative to baseline semver.
 */
export function isVersionSatisfyingImpact(
  baselineVersion: string,
  targetVersion: string,
  requiredImpact: VersionImpact,
): boolean {
  const base = parseSemVer(baselineVersion);
  const target = parseSemVer(targetVersion);

  if (target.major < base.major) return false;
  if (target.major === base.major && target.minor < base.minor) return false;
  if (target.major === base.major && target.minor === base.minor && target.patch < base.patch) {
    return false;
  }

  if (requiredImpact === "major") {
    return target.major > base.major;
  }

  if (requiredImpact === "minor") {
    return target.major > base.major || target.minor > base.minor;
  }

  return true;
}

/**
 * Compares baseline and target public action contracts to detect breaking and backward-compatible changes.
 */
export function comparePublicActionContracts(
  baseline: Record<PublicActionName, PublicActionContract>,
  target: Record<PublicActionName, PublicActionContract>,
): {
  breakingChanges: string[];
  changeDescriptor: Partial<ChangeDescriptor>;
} {
  const breakingChanges: string[] = [];
  let addedOptionalInputs = 0;
  let addedPublicOutputs = 0;
  let hasRequiredInputAddition = false;
  let hasOptionalToRequiredChange = false;
  let hasDefaultValueChange = false;
  let hasRemovedPublicInput = false;
  let hasRemovedPublicOutput = false;

  for (const actionName of PUBLIC_ACTIONS) {
    const baseContract = baseline[actionName];
    const targetContract = target[actionName];

    if (!baseContract) {
      continue;
    }

    if (!targetContract) {
      breakingChanges.push(`Public action "${actionName}" was removed from target contracts.`);
      hasRemovedPublicInput = true;
      continue;
    }

    const breaking = detectBreakingChanges(baseContract, targetContract);
    for (const b of breaking) {
      breakingChanges.push(`[${actionName}] ${b.problem}`);
      if (b.type === "REMOVED_INPUT") hasRemovedPublicInput = true;
      if (b.type === "REMOVED_OUTPUT") hasRemovedPublicOutput = true;
      if (b.type === "REQUIRED_CHANGED") hasOptionalToRequiredChange = true;
      if (b.type === "DEFAULT_CHANGED") hasDefaultValueChange = true;
    }

    const baseInputMap = new Map(baseContract.inputs.map((i) => [i.name, i]));
    for (const targetInput of targetContract.inputs) {
      if (!baseInputMap.has(targetInput.name)) {
        if (targetInput.required) {
          hasRequiredInputAddition = true;
          breakingChanges.push(
            `[${actionName}] Newly added public input "${targetInput.name}" is required.`,
          );
        } else {
          addedOptionalInputs++;
        }
      }
    }

    const baseOutputMap = new Map(baseContract.outputs.map((o) => [o.name, o]));
    for (const targetOutput of targetContract.outputs) {
      if (!baseOutputMap.has(targetOutput.name)) {
        addedPublicOutputs++;
      }
    }
  }

  return {
    breakingChanges,
    changeDescriptor: {
      hasRequiredInputAddition,
      hasOptionalToRequiredChange,
      hasDefaultValueChange,
      hasRemovedPublicInput,
      hasRemovedPublicOutput,
      addedOptionalInputs,
      addedPublicOutputs,
    },
  };
}

function validateCompatibilityModelStructure(
  model: CanonicalCompatibilityModel,
  label: string,
): void {
  if (!model || typeof model !== "object") {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: must be an object.`,
      { stage: "upgrade-guardrail" },
    );
  }
  if (!Array.isArray(model.runtimes) || !Array.isArray(model.packageManagers)) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: "runtimes" and "packageManagers" must be arrays.`,
      { stage: "upgrade-guardrail" },
    );
  }
  if (!Array.isArray(model.combinations)) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: "combinations" must be an array.`,
      { stage: "upgrade-guardrail" },
    );
  }
  for (const comb of model.combinations) {
    if (
      !comb ||
      typeof comb !== "object" ||
      typeof comb.runtime !== "string" ||
      typeof comb.packageManager !== "string" ||
      typeof comb.supported !== "boolean"
    ) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination entries must contain valid "runtime", "packageManager", and "supported" fields.`,
        { stage: "upgrade-guardrail" },
      );
    }
  }
}

/**
 * Compares baseline and target compatibility models to detect removed or added combinations.
 */
export function compareCompatibilityModels(
  baseline: CanonicalCompatibilityModel,
  target: CanonicalCompatibilityModel,
): {
  violations: string[];
  removedMatrixCombinations: number;
  addedMatrixCombinations: number;
} {
  validateCompatibilityModelStructure(baseline, "baseline");
  validateCompatibilityModelStructure(target, "target");

  const violations: string[] = [];
  let removedMatrixCombinations = 0;
  let addedMatrixCombinations = 0;

  const getCombKey = (c: MatrixCombinationEntry) => `${c.runtime}:${c.packageManager}`;

  const baselineMap = new Map(baseline.combinations.map((c) => [getCombKey(c), c]));
  const targetMap = new Map(target.combinations.map((c) => [getCombKey(c), c]));

  for (const [key, baseComb] of baselineMap) {
    if (baseComb.supported) {
      const targetComb = targetMap.get(key);
      if (!targetComb || !targetComb.supported) {
        removedMatrixCombinations++;
        violations.push(
          `Supported matrix combination "${baseComb.runtime}+${baseComb.packageManager}" was removed or marked unsupported.`,
        );
      }
    }
  }

  for (const [key, targetComb] of targetMap) {
    if (targetComb.supported) {
      const baseComb = baselineMap.get(key);
      if (!baseComb || !baseComb.supported) {
        addedMatrixCombinations++;
      }
    }
  }

  return {
    violations,
    removedMatrixCombinations,
    addedMatrixCombinations,
  };
}

/**
 * Evaluates baseline vs target contracts against upgrade guardrails.
 */
export function evaluateUpgradeGuardrails(
  baseline: BaselineContracts,
  target: TargetContracts,
  baseRef?: string,
): UpgradeGuardrailResult {
  const violations: string[] = [];

  const apiComp = comparePublicActionContracts(baseline.publicActions, target.publicActions);
  const compatComp = compareCompatibilityModels(
    baseline.compatibilityModel,
    target.compatibilityModel,
  );

  const changeDescriptor: ChangeDescriptor = {
    ...apiComp.changeDescriptor,
    removedMatrixCombinations: compatComp.removedMatrixCombinations,
    addedMatrixCombinations: compatComp.addedMatrixCombinations,
    newInputsOrOutputs:
      (apiComp.changeDescriptor.addedOptionalInputs || 0) +
      (apiComp.changeDescriptor.addedPublicOutputs || 0),
    backwardCompatibleFeatures:
      (apiComp.changeDescriptor.addedOptionalInputs || 0) > 0 ||
      (apiComp.changeDescriptor.addedPublicOutputs || 0) > 0 ||
      compatComp.addedMatrixCombinations > 0,
    isBugFixOrDocOnly:
      apiComp.breakingChanges.length === 0 &&
      compatComp.removedMatrixCombinations === 0 &&
      (apiComp.changeDescriptor.addedOptionalInputs || 0) === 0 &&
      (apiComp.changeDescriptor.addedPublicOutputs || 0) === 0 &&
      compatComp.addedMatrixCombinations === 0,
  };

  const requiredImpact = classifyChangeImpact(changeDescriptor);

  const isVersionOk = isVersionSatisfyingImpact(baseline.version, target.version, requiredImpact);
  if (!isVersionOk) {
    const changeSummary: string[] = [];
    if (apiComp.breakingChanges.length > 0) {
      changeSummary.push(...apiComp.breakingChanges);
    }
    if (compatComp.violations.length > 0) {
      changeSummary.push(...compatComp.violations);
    }
    if (changeSummary.length > 0) {
      violations.push(
        `Declared target version "${target.version}" is incompatible with required SemVer impact "${requiredImpact}" over baseline version "${baseline.version}". Changes requiring ${requiredImpact.toUpperCase()} version bump:\n  - ${changeSummary.join("\n  - ")}`,
      );
    } else {
      violations.push(
        `Declared target version "${target.version}" is incompatible with required SemVer impact "${requiredImpact}" over baseline version "${baseline.version}".`,
      );
    }
  }

  return {
    valid: violations.length === 0,
    baseRef,
    baselineVersion: baseline.version,
    targetVersion: target.version,
    requiredImpact,
    changeDescriptor,
    violations,
  };
}

/**
 * Parses CanonicalCompatibilityModel from src/compatibility.ts content.
 */
export function parseCompatibilityModelFromSource(content: string): CanonicalCompatibilityModel {
  const modelMatch = content.match(/const\s+CANONICAL_COMPATIBILITY_MODEL[^{]*(\{[\s\S]*?\});/);
  if (!modelMatch) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      "Unable to parse CANONICAL_COMPATIBILITY_MODEL from compatibility source.",
      { stage: "upgrade-guardrail" },
    );
  }

  try {
    let jsCode = modelMatch[1];
    jsCode = jsCode.replace(/as\s+const/g, "");
    jsCode = jsCode.replace(/:\s*CanonicalCompatibilityModel/g, "");
    const parsed = vm.runInNewContext(`(${jsCode})`);
    return parsed as CanonicalCompatibilityModel;
  } catch (err) {
    throw new WorkflowError(
      "INVALID_INPUT",
      "Failed to evaluate CANONICAL_COMPATIBILITY_MODEL from base source code.",
      { stage: "upgrade-guardrail", cause: err },
    );
  }
}

/**
 * Loads baseline contracts from git revision `baseRef`.
 */
export function loadBaselineContractsFromGit(
  baseRef: string,
  rootDir: string = process.cwd(),
): BaselineContracts {
  const gitExec = (cmd: string): string => {
    try {
      return execSync(cmd, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (err) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `Failed to retrieve base revision file from Git ref "${baseRef}": command "${cmd}" failed. Ensure Git base revision is available (e.g. non-shallow clone).`,
        { stage: "upgrade-guardrail", baseRef, cause: err },
      );
    }
  };

  const pkgJsonContent = gitExec(`git show ${baseRef}:package.json`);
  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(pkgJsonContent) as Record<string, unknown>;
  } catch (err) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Malformed package.json in base revision "${baseRef}".`,
      { stage: "upgrade-guardrail", cause: err },
    );
  }

  const version = typeof pkgJson.version === "string" ? pkgJson.version.trim() : "";
  if (!version) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Missing or invalid version in package.json from base revision "${baseRef}".`,
      { stage: "upgrade-guardrail" },
    );
  }

  const publicActions = {} as Record<PublicActionName, PublicActionContract>;
  for (const actionName of PUBLIC_ACTIONS) {
    let actionYamlContent = "";
    try {
      actionYamlContent = gitExec(`git show ${baseRef}:${actionName}/action.yml`);
    } catch {
      actionYamlContent = gitExec(`git show ${baseRef}:${actionName}/action.yaml`);
    }
    publicActions[actionName] = parseActionContractYaml(actionName, actionYamlContent);
  }

  const compatContent = gitExec(`git show ${baseRef}:src/compatibility.ts`);
  const compatibilityModel = parseCompatibilityModelFromSource(compatContent);

  return {
    version,
    publicActions,
    compatibilityModel,
  };
}

/**
 * Resolves the default base ref if not explicitly provided.
 */
export function resolveBaseRef(explicitBaseRef?: string): string {
  if (explicitBaseRef) return explicitBaseRef;
  if (process.env.UPGRADE_BASE_REF) return process.env.UPGRADE_BASE_REF;
  if (process.env.BASE_REF) return process.env.BASE_REF;
  if (process.env.GITHUB_BASE_REF) return process.env.GITHUB_BASE_REF;
  if (process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)) {
    return process.env.GITHUB_EVENT_BEFORE;
  }

  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" });
    return "origin/main";
  } catch {
    try {
      execSync("git rev-parse --verify main", { stdio: "ignore" });
      return "main";
    } catch {
      return "HEAD~1";
    }
  }
}

/**
 * Loads current target contracts from working directory.
 */
export function loadTargetContracts(rootDir: string = process.cwd()): TargetContracts {
  const { version } = getRepositoryVersion(rootDir);
  const publicActions = validateAllPublicActionContracts(rootDir);
  const compatibilityModel = CANONICAL_COMPATIBILITY_MODEL;

  return {
    version,
    publicActions,
    compatibilityModel,
  };
}

/**
 * Main function for verifying upgrade guardrails.
 */
export function verifyUpgradeGuardrails(
  options: UpgradeGuardrailOptions = {},
): UpgradeGuardrailResult {
  const rootDir = options.rootDir || process.cwd();
  const target = loadTargetContracts(rootDir);

  let baseline: BaselineContracts;
  let baseRefUsed: string | undefined;

  if (options.baselineContracts) {
    baseline = options.baselineContracts;
  } else {
    baseRefUsed = resolveBaseRef(options.baseRef);
    baseline = loadBaselineContractsFromGit(baseRefUsed, rootDir);
  }

  return evaluateUpgradeGuardrails(baseline, target, baseRefUsed);
}

/**
 * CLI entrypoint for upgrade guardrail verification.
 */
export function runUpgradeVerification(options: UpgradeGuardrailOptions = {}): void {
  try {
    const result = verifyUpgradeGuardrails(options);

    if (!result.valid) {
      console.error("Upgrade Guardrail Verification Failed:");
      if (result.baseRef) {
        console.error(`  Base Revision: ${result.baseRef}`);
      }
      console.error(`  Baseline Version: ${result.baselineVersion}`);
      console.error(`  Target Version:   ${result.targetVersion}`);
      console.error(`  Required Impact:  ${result.requiredImpact.toUpperCase()}`);
      console.error("  Violations:");
      for (const v of result.violations) {
        console.error(`    - ${v}`);
      }
      process.exit(1);
    }

    console.log(
      `Verified upgrade guardrails: target version "${result.targetVersion}" satisfies required impact "${result.requiredImpact}" over baseline version "${result.baselineVersion}"${result.baseRef ? ` (compared against ${result.baseRef})` : ""}.`,
    );
  } catch (error) {
    console.error("Upgrade Guardrail Verification Failed:");
    if (error instanceof WorkflowError) {
      console.error(`  [${error.code}] ${error.message}`);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ${msg}`);
    }
    process.exit(1);
  }
}
