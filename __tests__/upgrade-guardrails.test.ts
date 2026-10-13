import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

describe("Upgrade Guardrails Specification & Invariants", () => {
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
    autofix: sampleBaseContract,
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

      const target: TargetContracts = {
        version: "1.0.0",
        publicActions: targetActions,
        compatibilityModel: sampleBaseModel,
      };
      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(true);
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

    it("generic breaking change: removing any arbitrary public action requires major version bump", () => {
      const baseWithArbitraryAction: Record<string, PublicActionContract> = {
        "action-a": sampleBaseContract,
        "action-b": sampleBaseContract,
      };

      const targetWithRemovedAction: Record<string, PublicActionContract> = {
        "action-a": sampleBaseContract,
      };

      const comp = comparePublicActionContracts(baseWithArbitraryAction, targetWithRemovedAction);
      expect(
        comp.breakingChanges.some((b) => b.includes('Public action "action-b" was removed')),
      ).toBe(true);

      const target: TargetContracts = {
        version: "2.0.0",
        publicActions: targetWithRemovedAction,
        compatibilityModel: sampleBaseModel,
      };
      const baseline: BaselineContracts = {
        version: "1.0.0",
        publicActions: baseWithArbitraryAction,
        compatibilityModel: sampleBaseModel,
      };

      const res = evaluateUpgradeGuardrails(baseline, target);
      expect(res.valid).toBe(true);
      expect(res.requiredImpact).toBe("major");

      // With insufficient version bump (1.1.0), evaluateUpgradeGuardrails MUST fail
      const targetMinor: TargetContracts = {
        ...target,
        version: "1.1.0",
      };
      const resMinor = evaluateUpgradeGuardrails(baseline, targetMinor);
      expect(resMinor.valid).toBe(false);
    });

    it("adding a new public action alone is not classified as a removal", () => {
      const baseActions: Record<string, PublicActionContract> = {
        "action-a": sampleBaseContract,
      };

      const targetActions: Record<string, PublicActionContract> = {
        "action-a": sampleBaseContract,
        "action-b": sampleBaseContract,
      };

      const comp = comparePublicActionContracts(baseActions, targetActions);
      expect(comp.breakingChanges).toHaveLength(0);
      expect(comp.changeDescriptor.hasRemovedPublicInput).toBeFalsy();
    });
  });

  describe("Comprehensive Compatibility Model Validation", () => {
    it("passes when matrix is unchanged", () => {
      const comp = compareCompatibilityModels(sampleBaseModel, sampleBaseModel);
      expect(comp.violations).toHaveLength(0);
      expect(comp.removedMatrixCombinations).toBe(0);
      expect(comp.addedMatrixCombinations).toBe(0);
    });

    it("rejects duplicate runtimes", () => {
      const invalidModel = {
        ...sampleBaseModel,
        runtimes: ["node", "node"] as any,
      };
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        /duplicate runtime "node"/i,
      );
    });

    it("rejects duplicate package managers", () => {
      const invalidModel = {
        ...sampleBaseModel,
        packageManagers: ["npm", "npm"] as any,
      };
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        /duplicate package manager "npm"/i,
      );
    });

    it("rejects duplicate combination entries", () => {
      const invalidModel = {
        ...sampleBaseModel,
        combinations: [
          { runtime: "node", packageManager: "npm", supported: true },
          { runtime: "node", packageManager: "npm", supported: true },
        ] as any,
      };
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        /duplicate combination entry/i,
      );
    });

    it("rejects combination referencing undeclared runtime or package manager", () => {
      const invalidModel = {
        runtimes: ["node"],
        packageManagers: ["npm"],
        combinations: [
          { runtime: "bun", packageManager: "npm", supported: true },
        ] as any,
      };
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        /references runtime "bun" not present/i,
      );
    });

    it("fail-closed invariant: invalid compatibility models cause evaluateUpgradeGuardrails to fail even with major bump", () => {
      const targetModelWithRemovedRuntime: CanonicalCompatibilityModel = {
        runtimes: ["node"], // "bun" removed
        packageManagers: ["npm", "pnpm", "bun"],
        combinations: [
          { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
          { runtime: "node", packageManager: "pnpm", supported: true, isDefault: false },
        ],
      };

      const target: TargetContracts = {
        version: "2.0.0", // Major version bump supplied
        publicActions: sampleBaseActions,
        compatibilityModel: targetModelWithRemovedRuntime,
      };

      const res = evaluateUpgradeGuardrails(sampleBaseline, target);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.includes('Supported runtime "bun" was removed'))).toBe(
        true,
      );
    });

    it("rejects multiple default combinations in model", () => {
      const invalidModel = {
        ...sampleBaseModel,
        combinations: [
          { runtime: "node", packageManager: "npm", supported: true, isDefault: true },
          { runtime: "node", packageManager: "pnpm", supported: true, isDefault: true },
        ] as any,
      };
      expect(() => compareCompatibilityModels(sampleBaseModel, invalidModel)).toThrow(
        /at most one default combination/i,
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
      expect(
        res.violations.some((v) => v.includes("incompatible with required SemVer impact")),
      ).toBe(true);
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

  describe("Baseline Resolution & Immutable SHA Security Invariants", () => {
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

    it("fails explicitly when baseRef is missing or unresolvable", () => {
      expect(() => loadBaselineContractsFromGit("non-existent-git-ref-xyz-123456")).toThrow(
        /could not be resolved in repository history/,
      );
    });

    it("resolves PR event baseline via GITHUB_BASE_REF", () => {
      const origGhBase = process.env.GITHUB_BASE_REF;
      try {
        process.env.GITHUB_BASE_REF = "origin/main";
        const resolved = resolveBaseRef();
        expect(resolved).toMatch(/origin\/main/);
      } finally {
        if (origGhBase !== undefined) process.env.GITHUB_BASE_REF = origGhBase;
        else delete process.env.GITHUB_BASE_REF;
      }
    });

    it("resolves push event baseline via GITHUB_EVENT_BEFORE when valid previous commit SHA is provided", () => {
      const origGhBefore = process.env.GITHUB_EVENT_BEFORE;
      try {
        const baseSha = execFileSync(
          "git",
          ["rev-parse", "--verify", "origin/main^{commit}"],
          { encoding: "utf8" },
        ).trim();

        process.env.GITHUB_EVENT_BEFORE = baseSha;
        const resolved = resolveBaseRef();
        expect(resolved).toBe(baseSha);
      } finally {
        if (origGhBefore !== undefined) process.env.GITHUB_EVENT_BEFORE = origGhBefore;
        else delete process.env.GITHUB_EVENT_BEFORE;
      }
    });

    it("respects environment variable priority sequence: explicit > UPGRADE_BASE_REF > BASE_REF > GITHUB_BASE_REF > GITHUB_EVENT_BEFORE", () => {
      const origUpgrade = process.env.UPGRADE_BASE_REF;
      const origBase = process.env.BASE_REF;
      const origGhBase = process.env.GITHUB_BASE_REF;
      const origGhBefore = process.env.GITHUB_EVENT_BEFORE;

      try {
        process.env.UPGRADE_BASE_REF = "origin/main";
        process.env.BASE_REF = "invalid-base-ref";
        process.env.GITHUB_BASE_REF = "invalid-gh-base-ref";
        process.env.GITHUB_EVENT_BEFORE = "invalid-gh-before";

        expect(resolveBaseRef("origin/main")).toMatch(/origin\/main/);
        expect(resolveBaseRef()).toMatch(/origin\/main/);

        delete process.env.UPGRADE_BASE_REF;
        process.env.BASE_REF = "origin/main";
        expect(resolveBaseRef()).toMatch(/origin\/main/);

        delete process.env.BASE_REF;
        process.env.GITHUB_BASE_REF = "origin/main";
        expect(resolveBaseRef()).toMatch(/origin\/main/);

        delete process.env.GITHUB_BASE_REF;
        process.env.GITHUB_EVENT_BEFORE = "origin/main";
        expect(resolveBaseRef()).toMatch(/origin\/main/);
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

    it("prevents self-comparison when baseRef resolves to HEAD SHA", () => {
      expect(() => resolveBaseRef("HEAD")).toThrow(
        /resolves to current commit HEAD.*Comparing a commit against itself is strictly prohibited/,
      );
    });

    it("handles initial-push events with all-zero before SHA explicitly", () => {
      const origBefore = process.env.GITHUB_EVENT_BEFORE;
      try {
        process.env.GITHUB_EVENT_BEFORE = "0000000000000000000000000000000000000000";
        expect(() => resolveBaseRef()).toThrow(
          /All-zero "before" SHA detected in push event.*A trustworthy baseline commit cannot be established/,
        );
      } finally {
        if (origBefore !== undefined) process.env.GITHUB_EVENT_BEFORE = origBefore;
        else delete process.env.GITHUB_EVENT_BEFORE;
      }
    });

    it("handles option-like or malicious refs safely without shell execution", () => {
      expect(() => resolveBaseRef("--output=/tmp/hacked")).toThrow(
        /could not be resolved in repository history/,
      );
      expect(() => resolveBaseRef("; rm -rf /")).toThrow(
        /could not be resolved in repository history/,
      );
    });

    it("uses verified immutable SHA for baseline git file loads", () => {
      const headSha = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
        encoding: "utf8",
      }).trim();

      // Creating a temporary git repo with two distinct commits to test immutable SHA loading
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "upgrade-guardrail-test-sha-"));

      try {
        execFileSync("git", ["init", "-b", "main"], { cwd: tempDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "test@example.com"], {
          cwd: tempDir,
          stdio: "ignore",
        });

        fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
        fs.mkdirSync(path.join(tempDir, "action-a"), { recursive: true });

        fs.writeFileSync(
          path.join(tempDir, "package.json"),
          JSON.stringify({ name: "test", version: "1.0.0" }),
        );
        fs.writeFileSync(
          path.join(tempDir, "src/action-contract.ts"),
          `export const PUBLIC_ACTIONS = ["action-a"] as const;\n`,
        );
        fs.writeFileSync(
          path.join(tempDir, "action-a/action.yml"),
          `name: Action A\ndescription: Action A desc\n`,
        );
        fs.writeFileSync(
          path.join(tempDir, "src/compatibility.ts"),
          `export const CANONICAL_COMPATIBILITY_MODEL = {\n  runtimes: ["node"],\n  packageManagers: ["npm"],\n  combinations: [{ runtime: "node", packageManager: "npm", supported: true }]\n};\n`,
        );

        execFileSync("git", ["add", "."], { cwd: tempDir, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "initial baseline"], {
          cwd: tempDir,
          stdio: "ignore",
        });

        const c1Sha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: tempDir,
          encoding: "utf8",
        }).trim();

        // Second commit
        fs.writeFileSync(
          path.join(tempDir, "package.json"),
          JSON.stringify({ name: "test", version: "2.0.0" }),
        );
        execFileSync("git", ["add", "package.json"], { cwd: tempDir, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "commit 2"], { cwd: tempDir, stdio: "ignore" });

        // loadBaselineContractsFromGit pointing to c1Sha must retrieve v1.0.0 regardless of branch updates
        const loaded = loadBaselineContractsFromGit(c1Sha, tempDir);
        expect(loaded.version).toBe("1.0.0");
        expect(loaded.publicActions["action-a"]).toBeDefined();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
