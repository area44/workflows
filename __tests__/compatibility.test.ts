import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  CANONICAL_COMPATIBILITY_MODEL,
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getCombinationCompatibility,
  isSupportedPackageManager,
  isSupportedRuntime,
  validateRuntimePackageManagerCompatibility,
} from "../src/resolve-environment";

describe("Compatibility Contract Validation", () => {
  const rootDir = path.resolve(process.cwd());
  const compatibilityMd = fs.readFileSync(path.join(rootDir, "COMPATIBILITY.md"), "utf8");

  describe("Canonical Defaults Synchronization", () => {
    it("should keep DEFAULT_NODE_VERSION in resolve-environment synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_NODE_VERSION = "${DEFAULT_NODE_VERSION}"`);
      expect(compatibilityMd).toContain(`| Node.js   | \`DEFAULT_NODE_VERSION\`   | \`"${DEFAULT_NODE_VERSION}"\``);
    });

    it("should keep DEFAULT_BUN_VERSION in resolve-environment synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_BUN_VERSION = "${DEFAULT_BUN_VERSION}"`);
      expect(compatibilityMd).toContain(`| Bun       | \`DEFAULT_BUN_VERSION\`    | \`"${DEFAULT_BUN_VERSION}"\``);
    });

    it("should keep DEFAULT_NPM_VERSION in resolve-environment synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_NPM_VERSION = "${DEFAULT_NPM_VERSION}"`);
      expect(compatibilityMd).toContain(`| npm       | \`DEFAULT_NPM_VERSION\`    | \`"${DEFAULT_NPM_VERSION}"\``);
    });

    it("should keep DEFAULT_PNPM_VERSION in resolve-environment synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_PNPM_VERSION = "${DEFAULT_PNPM_VERSION}"`);
      expect(compatibilityMd).toContain(`| pnpm      | \`DEFAULT_PNPM_VERSION\`   | \`"${DEFAULT_PNPM_VERSION}"\``);
    });
  });

  describe("Canonical Compatibility Model Directives", () => {
    it("should export CANONICAL_COMPATIBILITY_MODEL with runtimes, packageManagers, and combinations", () => {
      expect(CANONICAL_COMPATIBILITY_MODEL).toBeDefined();
      expect(CANONICAL_COMPATIBILITY_MODEL.runtimes).toEqual(["node", "bun"]);
      expect(CANONICAL_COMPATIBILITY_MODEL.packageManagers).toEqual(["npm", "pnpm", "bun"]);
      expect(Array.isArray(CANONICAL_COMPATIBILITY_MODEL.combinations)).toBe(true);
    });

    it("should ensure helper functions derive directly from CANONICAL_COMPATIBILITY_MODEL", () => {
      for (const runtime of CANONICAL_COMPATIBILITY_MODEL.runtimes) {
        expect(isSupportedRuntime(runtime)).toBe(true);
      }
      for (const pm of CANONICAL_COMPATIBILITY_MODEL.packageManagers) {
        expect(isSupportedPackageManager(pm)).toBe(true);
      }
      for (const entry of CANONICAL_COMPATIBILITY_MODEL.combinations) {
        const res = getCombinationCompatibility(entry.runtime, entry.packageManager);
        expect(res.status.supported).toBe(entry.supported);
        if (entry.supported) {
          expect(res.status.isDefault).toBe(Boolean(entry.isDefault));
        } else {
          expect(res.status.reason).toBe(entry.reason);
        }
      }
    });

    it("should verify no duplicated compatibility matrices exist outside src/compatibility.ts", () => {
      const srcFiles = [
        "build-command.ts",
        "lint-format.ts",
        "resolve-environment.ts",
        "setup-adapters.ts",
        "site-variables.ts",
      ];
      for (const file of srcFiles) {
        const content = fs.readFileSync(path.join(rootDir, "src", file), "utf8");
        expect(content).not.toMatch(
          /runtime\s*===\s*["']bun["']\s*&&\s*(?:pmName|pm|packageManager(?:\.name)?)\s*===\s*["']npm["']/,
        );
      }
    });
  });

  describe("Composite Action Public Interfaces", () => {
    const actions = [
      {
        name: "astro",
        expectedInputs: ["path", "runtime", "build-command"],
        expectedOutputs: [
          "node-version",
          "bun-version",
          "package-manager",
          "package-manager-version",
          "runtime",
        ],
      },
      {
        name: "vite",
        expectedInputs: ["path", "runtime", "build-command"],
        expectedOutputs: [
          "node-version",
          "bun-version",
          "package-manager",
          "package-manager-version",
          "runtime",
        ],
      },
      {
        name: "vite-plus",
        expectedInputs: ["path", "runtime", "build-command"],
        expectedOutputs: [
          "node-version",
          "bun-version",
          "package-manager",
          "package-manager-version",
          "runtime",
          "vp-version",
        ],
      },
      {
        name: "lint-format",
        expectedInputs: ["runtime"],
        expectedOutputs: [
          "node-version",
          "bun-version",
          "package-manager",
          "package-manager-version",
          "runtime",
        ],
      },
    ];

    it.each(actions)(
      "action '$name' should retain all expected public inputs and outputs",
      ({ name, expectedInputs, expectedOutputs }) => {
        const actionYml = fs.readFileSync(path.join(rootDir, name, "action.yml"), "utf8");

        for (const inputKey of expectedInputs) {
          expect(actionYml).toMatch(new RegExp(`inputs:\\s*[\\s\\S]*?\\b${inputKey}:`));
        }

        for (const outputKey of expectedOutputs) {
          expect(actionYml).toMatch(new RegExp(`outputs:\\s*[\\s\\S]*?\\b${outputKey}:`));
        }

        // Verify that resolve_environment step passes INPUT_RUNTIME env var from inputs.runtime
        expect(actionYml).toMatch(
          /id:\s*resolve_environment[\s\S]*?env:[\s\S]*?INPUT_RUNTIME:\s*\$\{\{\s*inputs\.runtime\s*\}\}/,
        );
      },
    );
  });

  describe("Runtime & Package Manager Compatibility Contract", () => {
    describe("Type Guards Derived from Canonical Model", () => {
      it("should identify supported runtimes", () => {
        for (const runtime of CANONICAL_COMPATIBILITY_MODEL.runtimes) {
          expect(isSupportedRuntime(runtime)).toBe(true);
        }
        expect(isSupportedRuntime("deno")).toBe(false);
        expect(isSupportedRuntime("")).toBe(false);
      });

      it("should identify supported package managers", () => {
        for (const pm of CANONICAL_COMPATIBILITY_MODEL.packageManagers) {
          expect(isSupportedPackageManager(pm)).toBe(true);
        }
        expect(isSupportedPackageManager("yarn")).toBe(false);
        expect(isSupportedPackageManager("")).toBe(false);
      });
    });

    describe("Combination Matrix Evaluation Derived from Canonical Model", () => {
      const supportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
        (c) => c.supported,
      );
      const unsupportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
        (c) => !c.supported,
      );

      it.each(supportedCombinations)(
        "should mark runtime=$runtime and pm=$packageManager as supported (isDefault=$isDefault)",
        (comb) => {
          const res = getCombinationCompatibility(comb.runtime, comb.packageManager);
          expect(res.status.supported).toBe(true);
          expect(res.status.isDefault).toBe(Boolean(comb.isDefault));
          expect(() =>
            validateRuntimePackageManagerCompatibility(comb.runtime, comb.packageManager),
          ).not.toThrow();
        },
      );

      it.each(unsupportedCombinations)(
        "should mark runtime=$runtime and pm=$packageManager as unsupported with reason",
        (comb) => {
          const res = getCombinationCompatibility(comb.runtime, comb.packageManager);
          expect(res.status.supported).toBe(false);
          expect(res.status.reason).toBe(comb.reason);
          expect(() =>
            validateRuntimePackageManagerCompatibility(comb.runtime, comb.packageManager),
          ).toThrow(comb.reason);
        },
      );

      const unknownCases = [
        { runtime: "deno", pm: "npm", reasonSubstring: "Unsupported runtime" },
        { runtime: "node", pm: "yarn", reasonSubstring: "Unsupported package manager" },
        { runtime: "python", pm: "pip", reasonSubstring: "Unsupported runtime" },
      ];

      it.each(unknownCases)(
        "should mark unknown runtime=$runtime or pm=$pm as unsupported",
        ({ runtime, pm, reasonSubstring }) => {
          const res = getCombinationCompatibility(runtime, pm);
          expect(res.status.supported).toBe(false);
          expect(res.status.reason).toContain(reasonSubstring);
          expect(() => validateRuntimePackageManagerCompatibility(runtime, pm)).toThrow(
            reasonSubstring,
          );
        },
      );
    });

    describe("Critical Invariant Contract Assertions", () => {
      it("Node + npm must be supported and default", () => {
        const res = getCombinationCompatibility("node", "npm");
        expect(res.status.supported).toBe(true);
        expect(res.status.isDefault).toBe(true);
      });

      it("Node + pnpm and Node + bun must be supported", () => {
        expect(getCombinationCompatibility("node", "pnpm").status.supported).toBe(true);
        expect(getCombinationCompatibility("node", "bun").status.supported).toBe(true);
      });

      it("Bun + bun and Bun + pnpm must be supported", () => {
        expect(getCombinationCompatibility("bun", "bun").status.supported).toBe(true);
        expect(getCombinationCompatibility("bun", "pnpm").status.supported).toBe(true);
      });

      it("Bun + npm must be deterministically unsupported", () => {
        const res = getCombinationCompatibility("bun", "npm");
        expect(res.status.supported).toBe(false);
        expect(res.status.reason).toContain("Bun runtime does not support npm package manager");
      });
    });
  });

  describe("Compatibility Matrix Validation in CI Workflow", () => {
    const testActionsYml = fs.readFileSync(
      path.join(rootDir, ".github/workflows/test-actions.yml"),
      "utf8",
    );
    const actions = ["astro", "vite", "vite-plus", "lint-format"];
    const supportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
      (c) => c.supported,
    );
    const unsupportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
      (c) => !c.supported,
    );

    it("CI matrix should cover all declared supported combinations for every action", () => {
      for (const action of actions) {
        for (const comb of supportedCombinations) {
          const actionBlockRegex = new RegExp(
            `- action: ${action}\\s+runtime: ${comb.runtime}\\s+pm: ${comb.packageManager}`,
            "m",
          );
          expect(testActionsYml).toMatch(actionBlockRegex);
        }
      }
    });

    it("CI matrix should not contain any explicitly unsupported combinations", () => {
      for (const action of actions) {
        for (const comb of unsupportedCombinations) {
          const actionBlockRegex = new RegExp(
            `- action: ${action}\\s+runtime: ${comb.runtime}\\s+pm: ${comb.packageManager}`,
            "m",
          );
          expect(testActionsYml).not.toMatch(actionBlockRegex);
        }
      }
    });

    it("CI matrix entries must be valid according to CANONICAL_COMPATIBILITY_MODEL", () => {
      const matrixEntryRegex = /- action:\s*(\S+)\s+runtime:\s*(\S+)\s+pm:\s*(\S+)/g;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = matrixEntryRegex.exec(testActionsYml)) !== null) {
        count++;
        const [, actionName, runtime, pm] = match;
        expect(actions).toContain(actionName);
        expect(isSupportedRuntime(runtime)).toBe(true);
        expect(isSupportedPackageManager(pm)).toBe(true);

        const comp = getCombinationCompatibility(runtime, pm);
        expect(comp.status.supported).toBe(true);
      }
      expect(count).toBeGreaterThan(0);
    });

    it("should pass runtime input to all action steps in test-actions.yml", () => {
      for (const action of actions) {
        const stepRegex = new RegExp(
          `uses:\\s+\\./${action}[\\s\\S]*?with:\\s*\\n\\s*runtime:\\s*\\$\\{\\{\\s*matrix\\.runtime\\s*\\}\\}`,
        );
        expect(testActionsYml).toMatch(stepRegex);
      }
    });

    it("should verify runtime output against matrix.runtime in test-actions.yml", () => {
      expect(testActionsYml).toContain("EXPECTED_RUNTIME: ${{ matrix.runtime }}");
      expect(testActionsYml).toContain(
        'DETECTED_RUNTIME="${ASTRO_RUNTIME}${LINT_FORMAT_RUNTIME}${VITE_RUNTIME}${VITE_PLUS_RUNTIME}"',
      );
      expect(testActionsYml).toContain('[[ "$DETECTED_RUNTIME" == "$EXPECTED_RUNTIME" ]]');
    });
  });

  describe("Documentation Machine Validation against Canonical Model", () => {
    it("COMPATIBILITY.md should document all canonical supported runtimes", () => {
      for (const runtime of CANONICAL_COMPATIBILITY_MODEL.runtimes) {
        expect(compatibilityMd.toLowerCase()).toContain(runtime.toLowerCase());
      }
    });

    it("COMPATIBILITY.md should document all canonical supported package managers", () => {
      for (const pm of CANONICAL_COMPATIBILITY_MODEL.packageManagers) {
        expect(compatibilityMd.toLowerCase()).toContain(pm.toLowerCase());
      }
    });

    it("COMPATIBILITY.md should document all canonical supported combinations", () => {
      const supported = CANONICAL_COMPATIBILITY_MODEL.combinations.filter((c) => c.supported);
      for (const comb of supported) {
        const regex = new RegExp(`\`${comb.runtime}\`\\s*\\+\\s*\`${comb.packageManager}\``, "i");
        expect(compatibilityMd).toMatch(regex);
      }
    });

    it("COMPATIBILITY.md should document canonical unsupported combinations", () => {
      const unsupported = CANONICAL_COMPATIBILITY_MODEL.combinations.filter((c) => !c.supported);
      for (const comb of unsupported) {
        const regex = new RegExp(`\`${comb.runtime}\`\\s*\\+\\s*\`${comb.packageManager}\``, "i");
        expect(compatibilityMd).toMatch(regex);
      }
    });

    it("COMPATIBILITY.md should document the canonical default combination", () => {
      const defaultComb = CANONICAL_COMPATIBILITY_MODEL.combinations.find((c) => c.isDefault);
      expect(defaultComb).toBeDefined();
      if (defaultComb) {
        const regex = new RegExp(
          `\`${defaultComb.runtime}\`\\s*\\+\\s*\`${defaultComb.packageManager}\`[\\s\\S]*?default`,
          "i",
        );
        expect(compatibilityMd).toMatch(regex);
      }
    });
  });
});
