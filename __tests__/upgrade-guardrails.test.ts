import { describe, expect, it } from "vite-plus/test";

import type { PublicActionContract, PublicActionName } from "../src/action-contract";
import type { CanonicalCompatibilityModel } from "../src/compatibility";
import type { BaselineContracts, TargetContracts } from "../src/upgrade-guardrails";

import {
  compareCompatibilityModels,
  comparePublicActionContracts,
  evaluateUpgradeGuardrails,
  isVersionSatisfyingImpact,
  loadBaselineContractsFromGit,
  loadTargetContracts,
  parseCompatibilityModelFromSource,
  resolveBaseRef,
  verifyUpgradeGuardrails,
} from "../src/upgrade-guardrails";

describe("Upgrade Guardrails Specification", () => {
  const sampleBaseContract: PublicActionContract = {
    action: "sample-action",
    name: "Sample Action",
    description: "Sample description",
    inputs: [
      { name: "path", description: "Path", required: false, default: "dist" },
      { name: "runtime", description: "Runtime", required: false },
    ],
    outputs: [{ name: "runtime", description: "Resolved runtime" }],
  };

  const sampleBaseActions: Record<PublicActionName, PublicActionContract> = {
    astro: sampleBaseContract,
    vite: sampleBaseContract,
    "vite-plus": sampleBaseContract,
    "lint-format": sampleBaseContract,
  };

  const sampleBaseModel: CanonicalCompatibilityModel = {
    runtimes: ["node", "bun"],
    packageManagers: ["npm", "pnpm", "bun"],
    combinations: [
      { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
      { runtime: "node", packageManager: "pnpm", supported: true, isDefault: false },
      { runtime: "bun", packageManager: "bun", supported: true, isDefault: false },
      { runtime: "bun", packageManager: "npm", supported: false, reason: "Unsupported" },
    ],
  };

  const sampleBaseline: BaselineContracts = {
    version: "1.0.0",
    publicActions: sampleBaseActions,
    compatibilityModel: sampleBaseModel,
  };

  describe("Public Action API Guardrails", () => {
    it("passes when API is unchanged", () => {
      const targetActions = { ...sampleBaseActions };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges).toHaveLength(0);
      expect(comp.changeDescriptor.addedOptionalInputs).toBe(0);
      expect(comp.changeDescriptor.addedPublicOutputs).toBe(0);
    });

    it("classifies added optional input as compatible (minor impact)", () => {
      const targetAction: PublicActionContract = {
        ...sampleBaseContract,
        inputs: [
          ...sampleBaseContract.inputs,
          { name: "build-command", description: "Build command", required: false },
        ],
      };
      const targetActions = { ...sampleBaseActions, astro: targetAction };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges).toHaveLength(0);
      expect(comp.changeDescriptor.addedOptionalInputs).toBe(1);

      const target: TargetContracts = {
        version: "1.1.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const evalResult = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(evalResult.valid).toBe(true);
      expect(evalResult.requiredImpact).toBe("minor");
    });

    it("classifies added output as compatible (minor impact)", () => {
      const targetAction: PublicActionContract = {
        ...sampleBaseContract,
        outputs: [
          ...sampleBaseContract.outputs,
          { name: "node-version", description: "Node version" },
        ],
      };
      const targetActions = { ...sampleBaseActions, astro: targetAction };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges).toHaveLength(0);
      expect(comp.changeDescriptor.addedPublicOutputs).toBe(1);

      const target: TargetContracts = {
        version: "1.1.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const evalResult = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(evalResult.valid).toBe(true);
      expect(evalResult.requiredImpact).toBe("minor");
    });

    it("detects removed input as breaking", () => {
      const targetAction: PublicActionContract = {
        ...sampleBaseContract,
        inputs: sampleBaseContract.inputs.filter((i) => i.name !== "runtime"),
      };
      const targetActions = { ...sampleBaseActions, astro: targetAction };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges.length).toBeGreaterThan(0);
      expect(comp.changeDescriptor.hasRemovedPublicInput).toBe(true);
    });

    it("detects removed output as breaking", () => {
      const targetAction: PublicActionContract = {
        ...sampleBaseContract,
        outputs: [],
      };
      const targetActions = { ...sampleBaseActions, astro: targetAction };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges.length).toBeGreaterThan(0);
      expect(comp.changeDescriptor.hasRemovedPublicOutput).toBe(true);
    });

    it("detects optional to required input change as breaking", () => {
      const targetAction: PublicActionContract = {
        ...sampleBaseContract,
        inputs: sampleBaseContract.inputs.map((i) =>
          i.name === "runtime" ? { ...i, required: true } : i,
        ),
      };
      const targetActions = { ...sampleBaseActions, astro: targetAction };
      const comp = comparePublicActionContracts(sampleBaseActions, targetActions);
      expect(comp.breakingChanges.length).toBeGreaterThan(0);
      expect(comp.changeDescriptor.hasOptionalToRequiredChange).toBe(true);
    });
  });

  describe("Compatibility Model Guardrails", () => {
    it("passes when matrix is unchanged", () => {
      const comp = compareCompatibilityModels(sampleBaseModel, sampleBaseModel);
      expect(comp.violations).toHaveLength(0);
      expect(comp.removedMatrixCombinations).toBe(0);
      expect(comp.addedMatrixCombinations).toBe(0);
    });

    it("classifies added matrix combination as compatible (minor impact)", () => {
      const targetModel: CanonicalCompatibilityModel = {
        ...sampleBaseModel,
        combinations: [
          ...sampleBaseModel.combinations,
          { runtime: "node", packageManager: "bun", supported: true, isDefault: false },
        ],
      };
      const comp = compareCompatibilityModels(sampleBaseModel, targetModel);
      expect(comp.violations).toHaveLength(0);
      expect(comp.addedMatrixCombinations).toBe(1);

      const target: TargetContracts = {
        version: "1.1.0",
        publicActions: sampleBaseActions,
        compatibilityModel: targetModel,
      };
      const evalResult = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(evalResult.valid).toBe(true);
      expect(evalResult.requiredImpact).toBe("minor");
    });

    it("detects removed matrix combination as breaking", () => {
      const targetModel: CanonicalCompatibilityModel = {
        ...sampleBaseModel,
        combinations: sampleBaseModel.combinations.map((c) =>
          c.runtime === "bun" && c.packageManager === "bun" ? { ...c, supported: false } : c,
        ),
      };
      const comp = compareCompatibilityModels(sampleBaseModel, targetModel);
      expect(comp.violations.length).toBeGreaterThan(0);
      expect(comp.removedMatrixCombinations).toBe(1);
    });

    it("rejects invalid compatibility state structure", () => {
      const invalidModel = { runtimes: "invalid" } as unknown as CanonicalCompatibilityModel;
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        "Invalid target compatibility model",
      );
    });
  });

  describe("Version Impact Enforcement", () => {
    it("allows breaking change with major version bump", () => {
      const targetActions = {
        ...sampleBaseActions,
        astro: {
          ...sampleBaseContract,
          inputs: sampleBaseContract.inputs.filter((i) => i.name !== "runtime"),
        },
      };
      const target: TargetContracts = {
        version: "2.0.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(true);
      expect(res.requiredImpact).toBe("major");
    });

    it("fails breaking change with minor version bump", () => {
      const targetActions = {
        ...sampleBaseActions,
        astro: {
          ...sampleBaseContract,
          inputs: sampleBaseContract.inputs.filter((i) => i.name !== "runtime"),
        },
      };
      const target: TargetContracts = {
        version: "1.1.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(false);
      expect(res.requiredImpact).toBe("major");
      expect(res.violations.some((v) => v.includes("incompatible with required SemVer impact"))).toBe(
        true,
      );
    });

    it("fails breaking change with patch version bump", () => {
      const targetActions = {
        ...sampleBaseActions,
        astro: {
          ...sampleBaseContract,
          inputs: sampleBaseContract.inputs.filter((i) => i.name !== "runtime"),
        },
      };
      const target: TargetContracts = {
        version: "1.0.1",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(false);
      expect(res.requiredImpact).toBe("major");
    });

    it("allows compatible feature addition with minor version bump", () => {
      const targetActions = {
        ...sampleBaseActions,
        astro: {
          ...sampleBaseContract,
          inputs: [
            ...sampleBaseContract.inputs,
            { name: "build-command", description: "Build command", required: false },
          ],
        },
      };
      const target: TargetContracts = {
        version: "1.1.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(true);
      expect(res.requiredImpact).toBe("minor");
    });

    it("allows bug fix / internal change with patch version bump", () => {
      const target: TargetContracts = {
        version: "1.0.1",
        publicActions: sampleBaseActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(true);
      expect(res.requiredImpact).toBe("patch");
    });

    it("correctly evaluates version satisfying impact helper", () => {
      expect(isVersionSatisfyingImpact("1.0.0", "2.0.0", "major")).toBe(true);
      expect(isVersionSatisfyingImpact("1.0.0", "1.1.0", "major")).toBe(false);
      expect(isVersionSatisfyingImpact("1.0.0", "1.0.1", "major")).toBe(false);

      expect(isVersionSatisfyingImpact("1.0.0", "1.1.0", "minor")).toBe(true);
      expect(isVersionSatisfyingImpact("1.0.0", "2.0.0", "minor")).toBe(true);
      expect(isVersionSatisfyingImpact("1.0.0", "1.0.1", "minor")).toBe(false);

      expect(isVersionSatisfyingImpact("1.0.0", "1.0.0", "patch")).toBe(true);
      expect(isVersionSatisfyingImpact("1.0.0", "1.0.1", "patch")).toBe(true);
      expect(isVersionSatisfyingImpact("1.0.0", "0.9.9", "patch")).toBe(false);
    });
  });

  describe("Base Revision Resolution & Strict Non-Fallback Invariants", () => {
    it("parses compatibility model from source content", () => {
      const source = `
export const CANONICAL_COMPATIBILITY_MODEL: CanonicalCompatibilityModel = {
  runtimes: ["node", "bun"] as const,
  packageManagers: ["npm", "pnpm", "bun"] as const,
  combinations: [
    { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
  ] as const,
};
`;
      const parsed = parseCompatibilityModelFromSource(source);
      expect(parsed.runtimes).toEqual(["node", "bun"]);
      expect(parsed.combinations).toHaveLength(1);
      expect(parsed.combinations[0].runtime).toBe("node");
    });

    it("fails with actionable error when git base ref is missing or invalid", () => {
      expect(() => loadBaselineContractsFromGit("non-existent-git-ref-xyz-123456")).toThrow(
        /Failed to retrieve base revision file from Git ref/,
      );
    });

    it("executes verifyUpgradeGuardrails with provided baseline contracts", () => {
      const currentTarget = loadTargetContracts();
      const currentBaseline: BaselineContracts = {
        version: currentTarget.version,
        publicActions: currentTarget.publicActions,
        compatibilityModel: currentTarget.compatibilityModel,
      };
      const res = verifyUpgradeGuardrails({
        baselineContracts: currentBaseline,
      });
      expect(res.baselineVersion).toBe(currentTarget.version);
      expect(res.targetVersion).toBe(currentTarget.version);
      expect(res.valid).toBe(true);
    });

    it("uses explicitly provided valid baseRef", () => {
      const resolved = resolveBaseRef("main");
      expect(resolved).toMatch(/main/);
    });

    it("respects UPGRADE_BASE_REF environment variable when baseRef is omitted", () => {
      const origEnv = process.env.UPGRADE_BASE_REF;
      try {
        process.env.UPGRADE_BASE_REF = "main";
        const resolved = resolveBaseRef();
        expect(resolved).toMatch(/main/);
      } finally {
        if (origEnv !== undefined) {
          process.env.UPGRADE_BASE_REF = origEnv;
        } else {
          delete process.env.UPGRADE_BASE_REF;
        }
      }
    });

    it("throws WorkflowError when invalid or non-existent baseRef is explicitly provided and cannot resolve", () => {
      expect(() => resolveBaseRef("non-existent-ref-xyz-999")).toThrow(
        /could not be resolved in repository history.*Automatic guessing via relative revisions like "HEAD~1" is strictly prohibited/,
      );
    });

    it("respects environment variable priority sequence: explicit > UPGRADE_BASE_REF > BASE_REF > GITHUB_BASE_REF > GITHUB_EVENT_BEFORE", () => {
      const origUpgrade = process.env.UPGRADE_BASE_REF;
      const origBase = process.env.BASE_REF;
      const origGhBase = process.env.GITHUB_BASE_REF;
      const origGhBefore = process.env.GITHUB_EVENT_BEFORE;

      try {
        process.env.UPGRADE_BASE_REF = "main";
        process.env.BASE_REF = "invalid-base-ref";
        process.env.GITHUB_BASE_REF = "invalid-gh-base-ref";
        process.env.GITHUB_EVENT_BEFORE = "invalid-gh-before";

        expect(resolveBaseRef("main")).toMatch(/main/);
        expect(resolveBaseRef()).toMatch(/main/);

        delete process.env.UPGRADE_BASE_REF;
        process.env.BASE_REF = "main";
        expect(resolveBaseRef()).toMatch(/main/);

        delete process.env.BASE_REF;
        process.env.GITHUB_BASE_REF = "main";
        expect(resolveBaseRef()).toMatch(/main/);

        delete process.env.GITHUB_BASE_REF;
        process.env.GITHUB_EVENT_BEFORE = "main";
        expect(resolveBaseRef()).toMatch(/main/);
      } finally {
        if (origUpgrade !== undefined) process.env.UPGRADE_BASE_REF = origUpgrade;
        else delete process.env.UPGRADE_BASE_REF;

        if (origBase !== undefined) process.env.BASE_REF = origBase;
        else delete process.env.BASE_REF;

        if (origGhBase !== undefined) process.env.GITHUB_BASE_REF = origGhBase;
        else delete process.env.GITHUB_BASE_REF;

        if (origGhBefore !== undefined) process.env.GITHUB_EVENT_BEFORE = origGhBefore;
        else delete process.env.GITHUB_EVENT_BEFORE;
      }
    });

    it("throws WorkflowError in a repository where origin/main and main do NOT exist, never returning HEAD~1 even if HEAD~1 exists", () => {
      const execSync = require("node:child_process").execSync;
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-guardrail-test-"));

      try {
        execSync("git init -b custom-branch", { cwd: tempDir, stdio: "ignore" });
        execSync("git config user.name 'Test'", { cwd: tempDir, stdio: "ignore" });
        execSync("git config user.email 'test@example.com'", { cwd: tempDir, stdio: "ignore" });

        fs.writeFileSync(path.join(tempDir, "file1.txt"), "commit 1");
        execSync("git add file1.txt && git commit -m 'commit 1'", { cwd: tempDir, stdio: "ignore" });

        fs.writeFileSync(path.join(tempDir, "file2.txt"), "commit 2");
        execSync("git add file2.txt && git commit -m 'commit 2'", { cwd: tempDir, stdio: "ignore" });

        const origUpgrade = process.env.UPGRADE_BASE_REF;
        const origBase = process.env.BASE_REF;
        const origGhBase = process.env.GITHUB_BASE_REF;
        const origGhBefore = process.env.GITHUB_EVENT_BEFORE;

        delete process.env.UPGRADE_BASE_REF;
        delete process.env.BASE_REF;
        delete process.env.GITHUB_BASE_REF;
        delete process.env.GITHUB_EVENT_BEFORE;

        try {
          expect(() => resolveBaseRef(undefined, tempDir)).toThrow(
            /Unable to resolve a valid Git base revision for upgrade guardrails. Evaluated default candidates: origin\/main, main/,
          );
        } finally {
          if (origUpgrade !== undefined) process.env.UPGRADE_BASE_REF = origUpgrade;
          if (origBase !== undefined) process.env.BASE_REF = origBase;
          if (origGhBase !== undefined) process.env.GITHUB_BASE_REF = origGhBase;
          if (origGhBefore !== undefined) process.env.GITHUB_EVENT_BEFORE = origGhBefore;
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
