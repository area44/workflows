import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getCombinationCompatibility,
  isSupportedPackageManager,
  isSupportedRuntime,
  validateRuntimePackageManagerCompatibility,
} from "../src/detect-env";

describe("Compatibility Contract Validation", () => {
  const rootDir = path.resolve(process.cwd());
  const compatibilityMd = fs.readFileSync(path.join(rootDir, "COMPATIBILITY.md"), "utf8");

  describe("Canonical Defaults Synchronization", () => {
    it("should keep DEFAULT_NODE_VERSION in detect-env synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_NODE_VERSION = "${DEFAULT_NODE_VERSION}"`);
      expect(compatibilityMd).toContain(`| Node.js   | \`DEFAULT_NODE_VERSION\`   | \`"${DEFAULT_NODE_VERSION}"\``);
    });

    it("should keep DEFAULT_BUN_VERSION in detect-env synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_BUN_VERSION = "${DEFAULT_BUN_VERSION}"`);
      expect(compatibilityMd).toContain(`| Bun       | \`DEFAULT_BUN_VERSION\`    | \`"${DEFAULT_BUN_VERSION}"\``);
    });

    it("should keep DEFAULT_NPM_VERSION in detect-env synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_NPM_VERSION = "${DEFAULT_NPM_VERSION}"`);
      expect(compatibilityMd).toContain(`| npm       | \`DEFAULT_NPM_VERSION\`    | \`"${DEFAULT_NPM_VERSION}"\``);
    });

    it("should keep DEFAULT_PNPM_VERSION in detect-env synchronized with COMPATIBILITY.md", () => {
      expect(compatibilityMd).toContain(`DEFAULT_PNPM_VERSION = "${DEFAULT_PNPM_VERSION}"`);
      expect(compatibilityMd).toContain(`| pnpm      | \`DEFAULT_PNPM_VERSION\`   | \`"${DEFAULT_PNPM_VERSION}"\``);
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

        // Verify that detect_env step passes INPUT_RUNTIME env var from inputs.runtime
        expect(actionYml).toMatch(
          /id:\s*detect_env[\s\S]*?env:[\s\S]*?INPUT_RUNTIME:\s*\$\{\{\s*inputs\.runtime\s*\}\}/,
        );
      },
    );
  });

  describe("Runtime & Package Manager Compatibility Contract", () => {
    describe("Type Guards", () => {
      it("should identify supported runtimes", () => {
        expect(isSupportedRuntime("node")).toBe(true);
        expect(isSupportedRuntime("bun")).toBe(true);
        expect(isSupportedRuntime("deno")).toBe(false);
        expect(isSupportedRuntime("")).toBe(false);
      });

      it("should identify supported package managers", () => {
        expect(isSupportedPackageManager("npm")).toBe(true);
        expect(isSupportedPackageManager("pnpm")).toBe(true);
        expect(isSupportedPackageManager("bun")).toBe(true);
        expect(isSupportedPackageManager("yarn")).toBe(false);
        expect(isSupportedPackageManager("")).toBe(false);
      });
    });

    describe("Combination Matrix Evaluation", () => {
      const validCases = [
        { runtime: "node", pm: "npm", isDefault: true },
        { runtime: "node", pm: "pnpm", isDefault: false },
        { runtime: "node", pm: "bun", isDefault: false },
        { runtime: "bun", pm: "bun", isDefault: false },
        { runtime: "bun", pm: "pnpm", isDefault: false },
      ];

      it.each(validCases)(
        "should mark runtime=$runtime and pm=$pm as supported (isDefault=$isDefault)",
        ({ runtime, pm, isDefault }) => {
          const res = getCombinationCompatibility(runtime, pm);
          expect(res.status.supported).toBe(true);
          expect(res.status.isDefault).toBe(isDefault);
          expect(() => validateRuntimePackageManagerCompatibility(runtime, pm)).not.toThrow();
        },
      );

      const invalidCases = [
        { runtime: "bun", pm: "npm", reasonSubstring: "Bun runtime does not support npm" },
        { runtime: "deno", pm: "npm", reasonSubstring: "Unsupported runtime" },
        { runtime: "node", pm: "yarn", reasonSubstring: "Unsupported package manager" },
        { runtime: "python", pm: "pip", reasonSubstring: "Unsupported runtime" },
      ];

      it.each(invalidCases)(
        "should mark runtime=$runtime and pm=$pm as unsupported with clear reason",
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
  });

  describe("Compatibility Matrix Representation in CI Workflow", () => {
    const testActionsYml = fs.readFileSync(
      path.join(rootDir, ".github/workflows/test-actions.yml"),
      "utf8",
    );

    const supportedCombinations = [
      { action: "astro", runtime: "node", pm: "npm" },
      { action: "astro", runtime: "node", pm: "pnpm" },
      { action: "astro", runtime: "node", pm: "bun" },
      { action: "astro", runtime: "bun", pm: "bun" },
      { action: "astro", runtime: "bun", pm: "pnpm" },

      { action: "vite", runtime: "node", pm: "npm" },
      { action: "vite", runtime: "node", pm: "pnpm" },
      { action: "vite", runtime: "node", pm: "bun" },
      { action: "vite", runtime: "bun", pm: "bun" },
      { action: "vite", runtime: "bun", pm: "pnpm" },

      { action: "vite-plus", runtime: "node", pm: "npm" },
      { action: "vite-plus", runtime: "node", pm: "pnpm" },
      { action: "vite-plus", runtime: "node", pm: "bun" },
      { action: "vite-plus", runtime: "bun", pm: "bun" },
      { action: "vite-plus", runtime: "bun", pm: "pnpm" },

      { action: "lint-format", runtime: "node", pm: "npm" },
      { action: "lint-format", runtime: "node", pm: "pnpm" },
      { action: "lint-format", runtime: "node", pm: "bun" },
      { action: "lint-format", runtime: "bun", pm: "bun" },
      { action: "lint-format", runtime: "bun", pm: "pnpm" },
    ];

    it.each(supportedCombinations)(
      "CI matrix should cover combination action=$action, runtime=$runtime, pm=$pm",
      ({ action, runtime, pm }) => {
        expect(testActionsYml).toContain(`action: ${action}`);
        expect(testActionsYml).toContain(`runtime: ${runtime}`);
        expect(testActionsYml).toContain(`pm: ${pm}`);

        // Ensure there is a specific matrix entry containing all three for this action
        const actionBlockRegex = new RegExp(
          `- action: ${action}\\s+runtime: ${runtime}\\s+pm: ${pm}`,
          "m",
        );
        expect(testActionsYml).toMatch(actionBlockRegex);
      },
    );

    it("should pass runtime input to all action steps in test-actions.yml", () => {
      const actions = ["astro", "lint-format", "vite", "vite-plus"];
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
});
