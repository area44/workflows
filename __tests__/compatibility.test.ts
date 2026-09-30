import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

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

export interface MatrixEntry {
  action: string;
  runtime: string;
  pm: string;
  type: string;
  verify_site?: boolean;
}

export function extractWorkflowMatrixEntries(workflowYamlContent: string): MatrixEntry[] {
  const parsed = parseYaml(workflowYamlContent);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Failed to parse workflow YAML: document is invalid or not an object.");
  }
  const job = parsed.jobs?.["test-action"];
  if (!job) {
    throw new Error("Workflow YAML is missing job 'test-action'.");
  }
  const include = job.strategy?.matrix?.include;
  if (!Array.isArray(include)) {
    throw new Error(
      "Workflow YAML is missing 'jobs.test-action.strategy.matrix.include' array.",
    );
  }
  return include as MatrixEntry[];
}

export function validateWorkflowMatrix(entries: MatrixEntry[]): void {
  const actions = ["astro", "vite", "vite-plus", "lint-format"];
  const supportedCombinations = CANONICAL_COMPATIBILITY_MODEL.combinations.filter(
    (c) => c.supported,
  );

  for (const entry of entries) {
    if (!actions.includes(entry.action)) {
      throw new Error(`CI matrix entry contains unsupported action: ${entry.action}`);
    }
    if (!isSupportedRuntime(entry.runtime)) {
      throw new Error(`CI matrix entry contains unsupported runtime: ${entry.runtime}`);
    }
    if (!isSupportedPackageManager(entry.pm)) {
      throw new Error(`CI matrix entry contains unsupported package manager: ${entry.pm}`);
    }
    const comp = getCombinationCompatibility(entry.runtime, entry.pm);
    if (!comp.status.supported) {
      throw new Error(
        `CI matrix contains unsupported combination: ${entry.action} (${entry.runtime}, ${entry.pm})`,
      );
    }
  }

  for (const action of actions) {
    for (const comb of supportedCombinations) {
      const found = entries.some(
        (e) => e.action === action && e.runtime === comb.runtime && e.pm === comb.packageManager,
      );
      if (!found) {
        throw new Error(
          `CI matrix is missing supported combination: ${action} (${comb.runtime}, ${comb.packageManager})`,
        );
      }
    }
  }
}

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
    const testActionsYmlPath = path.join(rootDir, ".github/workflows/test-actions.yml");
    const testActionsYml = fs.readFileSync(testActionsYmlPath, "utf8");
    const actions = ["astro", "vite", "vite-plus", "lint-format"];

    it("should parse test-actions.yml structurally and extract matrix entries", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry).toHaveProperty("action");
        expect(entry).toHaveProperty("runtime");
        expect(entry).toHaveProperty("pm");
        expect(entry).toHaveProperty("type");
      }
    });

    it("should validate that CI matrix covers all canonical combinations and contains no unsupported entries", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      expect(() => validateWorkflowMatrix(entries)).not.toThrow();
    });

    it("should ensure every CI matrix entry has a corresponding fixture directory", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      for (const entry of entries) {
        const fixtureDir = path.join(
          rootDir,
          "__tests__/fixtures",
          entry.action,
          entry.runtime,
          entry.pm,
          entry.type,
        );
        expect(fs.existsSync(fixtureDir)).toBe(true);
      }
    });

    it("should fail validation if a supported combination is missing from matrix", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      // Remove astro (node, npm) basic entry
      const filtered = entries.filter(
        (e) => !(e.action === "astro" && e.runtime === "node" && e.pm === "npm"),
      );
      expect(() => validateWorkflowMatrix(filtered)).toThrow(
        "CI matrix is missing supported combination: astro (node, npm)",
      );
    });

    it("should fail validation if an unsupported combination (bun + npm) is present in matrix", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      const withUnsupported: MatrixEntry[] = [
        ...entries,
        { action: "vite", runtime: "bun", pm: "npm", type: "basic" },
      ];
      expect(() => validateWorkflowMatrix(withUnsupported)).toThrow(
        "CI matrix contains unsupported combination: vite (bun, npm)",
      );
    });

    it("should fail validation if matrix contains an invalid/unknown runtime", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      const withInvalidRuntime: MatrixEntry[] = [
        ...entries,
        { action: "astro", runtime: "deno", pm: "npm", type: "basic" },
      ];
      expect(() => validateWorkflowMatrix(withInvalidRuntime)).toThrow(
        "CI matrix entry contains unsupported runtime: deno",
      );
    });

    it("should fail validation if matrix contains an invalid/unknown package manager", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      const withInvalidPm: MatrixEntry[] = [
        ...entries,
        { action: "astro", runtime: "node", pm: "yarn", type: "basic" },
      ];
      expect(() => validateWorkflowMatrix(withInvalidPm)).toThrow(
        "CI matrix entry contains unsupported package manager: yarn",
      );
    });

    it("should fail validation if matrix contains an unsupported action name", () => {
      const entries = extractWorkflowMatrixEntries(testActionsYml);
      const withInvalidAction: MatrixEntry[] = [
        ...entries,
        { action: "unknown-action", runtime: "node", pm: "npm", type: "basic" },
      ];
      expect(() => validateWorkflowMatrix(withInvalidAction)).toThrow(
        "CI matrix entry contains unsupported action: unknown-action",
      );
    });

    it("should fail clearly on malformed YAML or missing matrix structure", () => {
      expect(() => extractWorkflowMatrixEntries("invalid: [yaml")).toThrow();
      expect(() => extractWorkflowMatrixEntries("jobs: {}")).toThrow(
        "Workflow YAML is missing job 'test-action'.",
      );
      expect(() => extractWorkflowMatrixEntries("jobs:\n  test-action: {}")).toThrow(
        "Workflow YAML is missing 'jobs.test-action.strategy.matrix.include' array.",
      );
    });

    it("should validate matrix independently of YAML formatting or style (quotes, whitespace, order)", () => {
      const yamlFormatted = `
jobs:
  test-action:
    strategy:
      matrix:
        include:
          - action: "astro"
            runtime: 'node'
            pm: "npm"
            type: 'basic'
          - action: astro
            runtime: node
            pm: npm
            type: minimal
          - action: astro
            runtime: node
            pm: pnpm
            type: basic
          - action: astro
            runtime: node
            pm: pnpm
            type: minimal
          - action: astro
            runtime: node
            pm: bun
            type: basic
          - action: astro
            runtime: node
            pm: bun
            type: minimal
          - action: astro
            runtime: bun
            pm: bun
            type: basic
          - action: astro
            runtime: bun
            pm: bun
            type: minimal
          - action: astro
            runtime: bun
            pm: pnpm
            type: basic

          - action: lint-format
            runtime: node
            pm: npm
            type: basic
          - action: lint-format
            runtime: node
            pm: npm
            type: minimal
          - action: lint-format
            runtime: node
            pm: pnpm
            type: basic
          - action: lint-format
            runtime: node
            pm: pnpm
            type: minimal
          - action: lint-format
            runtime: node
            pm: bun
            type: basic
          - action: lint-format
            runtime: node
            pm: bun
            type: minimal
          - action: lint-format
            runtime: bun
            pm: bun
            type: basic
          - action: lint-format
            runtime: bun
            pm: bun
            type: minimal
          - action: lint-format
            runtime: bun
            pm: pnpm
            type: basic

          - action: vite
            runtime: node
            pm: npm
            type: basic
          - action: vite
            runtime: node
            pm: npm
            type: minimal
          - action: vite
            runtime: node
            pm: pnpm
            type: basic
          - action: vite
            runtime: node
            pm: pnpm
            type: minimal
          - action: vite
            runtime: node
            pm: bun
            type: basic
          - action: vite
            runtime: node
            pm: bun
            type: minimal
          - action: vite
            runtime: bun
            pm: bun
            type: basic
          - action: vite
            runtime: bun
            pm: bun
            type: minimal
          - action: vite
            runtime: bun
            pm: pnpm
            type: basic

          - action: vite-plus
            runtime: node
            pm: npm
            type: basic
          - action: vite-plus
            runtime: node
            pm: npm
            type: minimal
          - action: vite-plus
            runtime: node
            pm: pnpm
            type: basic
          - action: vite-plus
            runtime: node
            pm: pnpm
            type: minimal
          - action: vite-plus
            runtime: node
            pm: bun
            type: basic
          - action: vite-plus
            runtime: node
            pm: bun
            type: minimal
          - action: vite-plus
            runtime: bun
            pm: bun
            type: basic
          - action: vite-plus
            runtime: bun
            pm: bun
            type: minimal
          - action: vite-plus
            runtime: bun
            pm: pnpm
            type: basic
`;
      const entries = extractWorkflowMatrixEntries(yamlFormatted);
      expect(() => validateWorkflowMatrix(entries)).not.toThrow();
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
