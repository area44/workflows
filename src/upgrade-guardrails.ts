import { execFileSync } from "node:child_process";
import vm from "node:vm";

import type { PublicActionContract } from "./action-contract.js";
import type { CanonicalCompatibilityModel, MatrixCombinationEntry } from "./compatibility.js";

import {
  detectBreakingChanges,
  parseActionContractYaml,
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
  publicActions: Record<string, PublicActionContract>;
  compatibilityModel: CanonicalCompatibilityModel;
}

export interface TargetContracts {
  version: string;
  publicActions: Record<string, PublicActionContract>;
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
interface ActionDiffFlags {
  hasRequiredInputAddition: boolean;
  hasOptionalToRequiredChange: boolean;
  hasDefaultValueChange: boolean;
  hasRemovedPublicInput: boolean;
  hasRemovedPublicOutput: boolean;
  addedOptionalInputs: number;
  addedPublicOutputs: number;
}

function processNewActionContract(
  actionName: string,
  targetContract: PublicActionContract,
  flags: ActionDiffFlags,
  breakingChanges: string[],
): void {
  flags.addedOptionalInputs += targetContract.inputs.filter((i) => !i.required).length;
  flags.addedPublicOutputs += targetContract.outputs.length;
  if (targetContract.inputs.some((i) => i.required)) {
    flags.hasRequiredInputAddition = true;
    breakingChanges.push(`Newly added public action "${actionName}" has required inputs.`);
  }
}

function processBreakingChanges(
  actionName: string,
  baseContract: PublicActionContract,
  targetContract: PublicActionContract,
  flags: ActionDiffFlags,
  breakingChanges: string[],
): void {
  const breaking = detectBreakingChanges(baseContract, targetContract);
  for (const b of breaking) {
    breakingChanges.push(`[${actionName}] ${b.problem}`);
    if (b.type === "REMOVED_INPUT") flags.hasRemovedPublicInput = true;
    if (b.type === "REMOVED_OUTPUT") flags.hasRemovedPublicOutput = true;
    if (b.type === "REQUIRED_CHANGED") flags.hasOptionalToRequiredChange = true;
    if (b.type === "DEFAULT_CHANGED") flags.hasDefaultValueChange = true;
  }
}

function processActionInputsAndOutputs(
  actionName: string,
  baseContract: PublicActionContract,
  targetContract: PublicActionContract,
  flags: ActionDiffFlags,
  breakingChanges: string[],
): void {
  const baseInputMap = new Map(baseContract.inputs.map((i) => [i.name, i]));
  for (const targetInput of targetContract.inputs) {
    if (!baseInputMap.has(targetInput.name)) {
      if (targetInput.required) {
        flags.hasRequiredInputAddition = true;
        breakingChanges.push(
          `[${actionName}] Newly added public input "${targetInput.name}" is required.`,
        );
      } else {
        flags.addedOptionalInputs++;
      }
    }
  }

  const baseOutputMap = new Map(baseContract.outputs.map((o) => [o.name, o]));
  for (const targetOutput of targetContract.outputs) {
    if (!baseOutputMap.has(targetOutput.name)) {
      flags.addedPublicOutputs++;
    }
  }
}

/**
 * Compares baseline and target public action contracts to detect breaking and backward-compatible changes.
 */
export function comparePublicActionContracts(
  baseline: Record<string, PublicActionContract>,
  target: Record<string, PublicActionContract>,
): {
  breakingChanges: string[];
  changeDescriptor: Partial<ChangeDescriptor>;
} {
  const breakingChanges: string[] = [];
  const flags: ActionDiffFlags = {
    addedOptionalInputs: 0,
    addedPublicOutputs: 0,
    hasRequiredInputAddition: false,
    hasOptionalToRequiredChange: false,
    hasDefaultValueChange: false,
    hasRemovedPublicInput: false,
    hasRemovedPublicOutput: false,
  };

  const allActionNames = Array.from(new Set([...Object.keys(baseline), ...Object.keys(target)]));

  for (const actionName of allActionNames) {
    const baseContract = baseline[actionName];
    const targetContract = target[actionName];

    if (!baseContract && targetContract) {
      processNewActionContract(actionName, targetContract, flags, breakingChanges);
      continue;
    }

    if (!baseContract) {
      continue;
    }

    if (!targetContract) {
      breakingChanges.push(`Public action "${actionName}" was removed from target contracts.`);
      flags.hasRemovedPublicInput = true;
      continue;
    }

    processBreakingChanges(actionName, baseContract, targetContract, flags, breakingChanges);
    processActionInputsAndOutputs(actionName, baseContract, targetContract, flags, breakingChanges);
  }

  return {
    breakingChanges,
    changeDescriptor: { ...flags },
  };
}

/**
 * Comprehensively validates structure and consistency of a CanonicalCompatibilityModel.
 */
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

  if (!Array.isArray(model.runtimes) || model.runtimes.length === 0) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: "runtimes" must be a non-empty array.`,
      { stage: "upgrade-guardrail" },
    );
  }

  const seenRuntimes = new Set<string>();
  for (const rt of model.runtimes) {
    if (typeof rt !== "string" || rt.trim() === "") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: "runtimes" elements must be non-empty strings.`,
        { stage: "upgrade-guardrail" },
      );
    }
    if (seenRuntimes.has(rt)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: duplicate runtime "${rt}" found in runtimes list.`,
        { stage: "upgrade-guardrail" },
      );
    }
    seenRuntimes.add(rt);
  }

  if (!Array.isArray(model.packageManagers) || model.packageManagers.length === 0) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: "packageManagers" must be a non-empty array.`,
      { stage: "upgrade-guardrail" },
    );
  }

  const seenPms = new Set<string>();
  for (const pm of model.packageManagers) {
    if (typeof pm !== "string" || pm.trim() === "") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: "packageManagers" elements must be non-empty strings.`,
        { stage: "upgrade-guardrail" },
      );
    }
    if (seenPms.has(pm)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: duplicate package manager "${pm}" found in packageManagers list.`,
        { stage: "upgrade-guardrail" },
      );
    }
    seenPms.add(pm);
  }

  if (!Array.isArray(model.combinations) || model.combinations.length === 0) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: "combinations" must be a non-empty array.`,
      { stage: "upgrade-guardrail" },
    );
  }

  const seenCombinations = new Set<string>();
  let defaultCount = 0;

  for (const comb of model.combinations) {
    if (!comb || typeof comb !== "object") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination entries must be objects.`,
        { stage: "upgrade-guardrail" },
      );
    }

    if (typeof comb.runtime !== "string" || comb.runtime.trim() === "") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination field "runtime" must be a non-empty string.`,
        { stage: "upgrade-guardrail" },
      );
    }

    if (!seenRuntimes.has(comb.runtime)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination references runtime "${comb.runtime}" not present in declared runtimes.`,
        { stage: "upgrade-guardrail" },
      );
    }

    if (typeof comb.packageManager !== "string" || comb.packageManager.trim() === "") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination field "packageManager" must be a non-empty string.`,
        { stage: "upgrade-guardrail" },
      );
    }

    if (!seenPms.has(comb.packageManager)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination references package manager "${comb.packageManager}" not present in declared packageManagers.`,
        { stage: "upgrade-guardrail" },
      );
    }

    if (typeof comb.supported !== "boolean") {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: combination field "supported" must be a boolean.`,
        { stage: "upgrade-guardrail" },
      );
    }

    const key = `${comb.runtime}:${comb.packageManager}`;
    if (seenCombinations.has(key)) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Invalid ${label} compatibility model: duplicate combination entry found for "${comb.runtime}+${comb.packageManager}".`,
        { stage: "upgrade-guardrail" },
      );
    }
    seenCombinations.add(key);

    if (comb.isDefault !== undefined) {
      if (typeof comb.isDefault !== "boolean") {
        throw new WorkflowError(
          "INVALID_INPUT",
          `Invalid ${label} compatibility model: combination field "isDefault" must be a boolean.`,
          { stage: "upgrade-guardrail" },
        );
      }
      if (comb.isDefault) {
        if (!comb.supported) {
          throw new WorkflowError(
            "INVALID_INPUT",
            `Invalid ${label} compatibility model: unsupported combination "${comb.runtime}+${comb.packageManager}" cannot be marked as default.`,
            { stage: "upgrade-guardrail" },
          );
        }
        defaultCount++;
      }
    }

    if (!comb.supported) {
      if (
        comb.reason !== undefined &&
        (typeof comb.reason !== "string" || comb.reason.trim() === "")
      ) {
        throw new WorkflowError(
          "INVALID_INPUT",
          `Invalid ${label} compatibility model: unsupported combination "${comb.runtime}+${comb.packageManager}" must have a valid non-empty reason string when specified.`,
          { stage: "upgrade-guardrail" },
        );
      }
    }
  }

  if (defaultCount > 1) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Invalid ${label} compatibility model: at most one default combination may be declared (found ${defaultCount}).`,
      { stage: "upgrade-guardrail" },
    );
  }
}

/**
 * Compares baseline and target compatibility models to detect removed runtimes, package managers, or combinations.
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

  for (const baseRt of baseline.runtimes) {
    if (!target.runtimes.includes(baseRt)) {
      violations.push(`Supported runtime "${baseRt}" was removed from target compatibility model.`);
      removedMatrixCombinations++;
    }
  }

  for (const basePm of baseline.packageManagers) {
    if (!target.packageManagers.includes(basePm)) {
      violations.push(
        `Supported package manager "${basePm}" was removed from target compatibility model.`,
      );
      removedMatrixCombinations++;
    }
  }

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

  let compatComp: {
    violations: string[];
    removedMatrixCombinations: number;
    addedMatrixCombinations: number;
  };

  try {
    compatComp = compareCompatibilityModels(baseline.compatibilityModel, target.compatibilityModel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    compatComp = {
      violations: [`Compatibility model validation error: ${msg}`],
      removedMatrixCombinations: 1,
      addedMatrixCombinations: 0,
    };
  }

  if (compatComp.violations.length > 0) {
    violations.push(...compatComp.violations);
  }

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
    if (apiComp.breakingChanges.length > 0) {
      violations.push(
        `Declared target version "${target.version}" is incompatible with required SemVer impact "${requiredImpact}" over baseline version "${baseline.version}". Changes requiring ${requiredImpact.toUpperCase()} version bump:\n  - ${apiComp.breakingChanges.join("\n  - ")}`,
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
 * Safely resolves a candidate Git ref to its full commit SHA using argument-based execFileSync.
 */
function verifyGitRef(
  candidate: string,
  rootDir: string,
): { ref: string; sha: string } | undefined {
  if (!candidate || typeof candidate !== "string" || candidate.trim() === "") {
    return undefined;
  }

  const trimmed = candidate.trim();
  if (trimmed.startsWith("-")) {
    return undefined;
  }

  try {
    const sha = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${trimmed}^{commit}`], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha && /^[0-9a-fA-F]{40}$/.test(sha)) {
      return { ref: trimmed, sha };
    }
  } catch {
    if (!trimmed.startsWith("origin/")) {
      try {
        const sha = execFileSync(
          "git",
          ["rev-parse", "--verify", "--quiet", `origin/${trimmed}^{commit}`],
          { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        if (sha && /^[0-9a-fA-F]{40}$/.test(sha)) {
          return { ref: `origin/${trimmed}`, sha };
        }
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Resolves current HEAD commit SHA.
 */
function getHeadSha(rootDir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      "Failed to resolve HEAD commit SHA in Git repository.",
      { stage: "upgrade-guardrail", cause: err },
    );
  }
}

/**
 * Loads baseline contracts from git revision `baseRef`, strictly using the verified immutable commit SHA.
 */
export function loadBaselineContractsFromGit(
  baseRef: string,
  rootDir: string = process.cwd(),
): BaselineContracts {
  const verifiedBase = verifyGitRef(baseRef, rootDir);
  if (!verifiedBase) {
    throw new WorkflowError(
      "MISSING_CONFIGURATION",
      `Git base revision "${baseRef}" could not be resolved in repository history. Ensure base revision exists and Git checkout has required depth.`,
      { stage: "upgrade-guardrail", baseRef },
    );
  }

  const gitShow = (fileInRepo: string): string => {
    try {
      return execFileSync("git", ["show", `${verifiedBase.sha}:${fileInRepo}`], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `Failed to retrieve base revision file "${fileInRepo}" from Git commit "${verifiedBase.sha}". Ensure Git base revision is available (e.g. non-shallow clone).`,
        {
          stage: "upgrade-guardrail",
          baseRef,
          sha: verifiedBase.sha,
          file: fileInRepo,
          cause: err,
        },
      );
    }
  };

  const pkgJsonContent = gitShow("package.json");
  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(pkgJsonContent) as Record<string, unknown>;
  } catch (err) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Malformed package.json in base revision "${baseRef}" (${verifiedBase.sha}).`,
      { stage: "upgrade-guardrail", cause: err },
    );
  }

  const version = typeof pkgJson.version === "string" ? pkgJson.version.trim() : "";
  if (!version) {
    throw new WorkflowError(
      "INVALID_INPUT",
      `Missing or invalid version in package.json from base revision "${baseRef}" (${verifiedBase.sha}).`,
      { stage: "upgrade-guardrail" },
    );
  }

  let basePublicActions: string[] = [];
  let contractSource: string | undefined;
  try {
    contractSource = gitShow("src/action-contract.ts");
  } catch {
    // src/action-contract.ts is missing in baseline revision
  }

  if (contractSource) {
    const match = contractSource.match(
      /export\s+const\s+PUBLIC_ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
    );
    if (!match || !match[1]) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Failed to parse PUBLIC_ACTIONS array from "src/action-contract.ts" in base revision "${baseRef}" (${verifiedBase.sha}).`,
        { stage: "upgrade-guardrail", baseRef },
      );
    }

    const extracted = Array.from(match[1].matchAll(/["\x27]([^"\x27]+)["\x27]/g)).map((m) => m[1]);
    if (extracted.length === 0) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Parsed empty PUBLIC_ACTIONS array from "src/action-contract.ts" in base revision "${baseRef}" (${verifiedBase.sha}).`,
        { stage: "upgrade-guardrail", baseRef },
      );
    }
    basePublicActions = extracted;
  } else {
    try {
      const treeOutput = execFileSync("git", ["ls-tree", "--name-only", verifiedBase.sha], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const entries = treeOutput
        .split("\n")
        .map((e) => e.trim())
        .filter(Boolean);
      for (const entry of entries) {
        if (
          entry.startsWith(".") ||
          entry === "node_modules" ||
          entry === "src" ||
          entry === "dist" ||
          entry === "docs" ||
          entry === "__tests__"
        ) {
          continue;
        }
        let hasYml = false;
        try {
          gitShow(`${entry}/action.yml`);
          hasYml = true;
        } catch {
          try {
            gitShow(`${entry}/action.yaml`);
            hasYml = true;
          } catch {
            // Not an action dir
          }
        }
        if (hasYml) {
          basePublicActions.push(entry);
        }
      }
    } catch {
      // Failed to list git tree
    }

    if (basePublicActions.length === 0) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `Unable to construct trustworthy baseline contracts from Git ref "${baseRef}" (${verifiedBase.sha}): missing "src/action-contract.ts" and no valid public action directories found in base revision.`,
        { stage: "upgrade-guardrail", baseRef },
      );
    }
  }

  const publicActions = {} as Record<string, PublicActionContract>;
  for (const actionName of basePublicActions) {
    let actionYamlContent = "";
    try {
      actionYamlContent = gitShow(`${actionName}/action.yml`);
    } catch {
      try {
        actionYamlContent = gitShow(`${actionName}/action.yaml`);
      } catch {
        throw new WorkflowError(
          "MISSING_CONFIGURATION",
          `Missing action.yml/action.yaml for public action "${actionName}" in base revision "${baseRef}" (${verifiedBase.sha}).`,
          { stage: "upgrade-guardrail", actionName, baseRef },
        );
      }
    }
    publicActions[actionName] = parseActionContractYaml(actionName, actionYamlContent);
  }

  const compatContent = gitShow("src/compatibility.ts");
  const compatibilityModel = parseCompatibilityModelFromSource(compatContent);

  return {
    version,
    publicActions,
    compatibilityModel,
  };
}

/**
 * Resolves the default base ref if not explicitly provided, adhering strictly to baseline selection rules.
 */
export function resolveBaseRef(explicitBaseRef?: string, rootDir: string = process.cwd()): string {
  const headSha = getHeadSha(rootDir);

  if (explicitBaseRef && explicitBaseRef.trim() !== "") {
    const trimmed = explicitBaseRef.trim();
    const resolved = verifyGitRef(trimmed, rootDir);
    if (!resolved) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `Explicitly specified Git base revision "${trimmed}" could not be resolved in repository history. Ensure base revision exists and Git checkout has required depth. Automatic guessing via relative revisions like "HEAD~1" is strictly prohibited.`,
        { stage: "upgrade-guardrail", candidate: trimmed },
      );
    }
    if (resolved.sha === headSha) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Baseline revision "${trimmed}" (${resolved.sha}) resolves to current commit HEAD (${headSha}). Comparing a commit against itself is strictly prohibited for upgrade guardrails. Ensure a valid previous commit or base branch is provided.`,
        { stage: "upgrade-guardrail", candidate: trimmed, sha: resolved.sha },
      );
    }
    return resolved.ref;
  }

  const envCandidates = [
    { name: "UPGRADE_BASE_REF", value: process.env.UPGRADE_BASE_REF },
    { name: "BASE_REF", value: process.env.BASE_REF },
    { name: "GITHUB_BASE_REF", value: process.env.GITHUB_BASE_REF },
  ];

  for (const envVar of envCandidates) {
    if (envVar.value && envVar.value.trim() !== "") {
      const candidateVal = envVar.value.trim();
      const resolved = verifyGitRef(candidateVal, rootDir);
      if (!resolved) {
        throw new WorkflowError(
          "MISSING_CONFIGURATION",
          `Configured Git base revision from ${envVar.name} "${candidateVal}" could not be resolved in repository history. Ensure base revision exists and Git checkout has required depth. Automatic guessing via relative revisions like "HEAD~1" is strictly prohibited.`,
          { stage: "upgrade-guardrail", envVar: envVar.name, candidate: candidateVal },
        );
      }
      if (resolved.sha === headSha) {
        throw new WorkflowError(
          "INVALID_INPUT",
          `Baseline revision from ${envVar.name} "${candidateVal}" (${resolved.sha}) resolves to current commit HEAD (${headSha}). Comparing a commit against itself is strictly prohibited for upgrade guardrails. Ensure a valid previous commit or base branch is provided.`,
          {
            stage: "upgrade-guardrail",
            envVar: envVar.name,
            candidate: candidateVal,
            sha: resolved.sha,
          },
        );
      }
      return resolved.ref;
    }
  }

  if (process.env.GITHUB_EVENT_BEFORE && process.env.GITHUB_EVENT_BEFORE.trim() !== "") {
    const beforeVal = process.env.GITHUB_EVENT_BEFORE.trim();
    if (/^0+$/.test(beforeVal)) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `All-zero "before" SHA detected in push event ("${beforeVal}"). A trustworthy baseline commit cannot be established for initial push events without previous commit history. Supply an explicit baseline ref via UPGRADE_BASE_REF or BASE_REF.`,
        { stage: "upgrade-guardrail", beforeSha: beforeVal },
      );
    }

    const resolved = verifyGitRef(beforeVal, rootDir);
    if (!resolved) {
      throw new WorkflowError(
        "MISSING_CONFIGURATION",
        `Git "before" commit from push event "${beforeVal}" could not be resolved in repository history. Ensure base revision exists and Git checkout has required depth.`,
        { stage: "upgrade-guardrail", candidate: beforeVal },
      );
    }
    if (resolved.sha === headSha) {
      throw new WorkflowError(
        "INVALID_INPUT",
        `Baseline revision from GITHUB_EVENT_BEFORE "${beforeVal}" (${resolved.sha}) resolves to current commit HEAD (${headSha}). Comparing a commit against itself is strictly prohibited for upgrade guardrails. Ensure a valid previous commit or base branch is provided.`,
        { stage: "upgrade-guardrail", candidate: beforeVal, sha: resolved.sha },
      );
    }
    return resolved.ref;
  }

  const defaultCandidates = ["origin/main", "main"];
  for (const cand of defaultCandidates) {
    const resolved = verifyGitRef(cand, rootDir);
    if (resolved && resolved.sha !== headSha) {
      return resolved.ref;
    }
  }

  throw new WorkflowError(
    "MISSING_CONFIGURATION",
    `Unable to resolve a valid Git base revision for upgrade guardrails. Evaluated default candidates: origin/main, main. Ensure a valid base revision is supplied (e.g. via baseRef or BASE_REF environment variable) or that Git repository history contains origin/main or main. Automatic guessing via relative revisions like "HEAD~1" is strictly prohibited.`,
    { stage: "upgrade-guardrail" },
  );
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
    baseRefUsed = resolveBaseRef(options.baseRef, rootDir);
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
