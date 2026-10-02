import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  parseActionContract,
  validateAllPublicActionContracts,
} from "../src/action-contract";
import {
  CANONICAL_COMPATIBILITY_MODEL,
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
} from "../src/resolve-environment";

describe("Documentation Consistency Verification", () => {
  const rootDir = path.resolve(process.cwd());
  const readmeContent = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
  const compatibilityContent = fs.readFileSync(path.join(rootDir, "COMPATIBILITY.md"), "utf8");
  const docsDir = path.join(rootDir, "docs");

  describe("Documentation Architecture & Navigation", () => {
    it("README.md should exist and contain main entry point usage and action navigation", () => {
      expect(readmeContent).toContain("area44/workflows");
      expect(readmeContent).toContain("Composite Actions");
      expect(readmeContent).toContain("Quick Usage");
      expect(readmeContent).toContain("Public Action API Summary");
      expect(readmeContent).toContain("Compatibility Overview");
      expect(readmeContent).toContain("Documentation Architecture");
    });

    it("README.md should link to COMPATIBILITY.md and all specialized docs files", () => {
      expect(readmeContent).toContain("./COMPATIBILITY.md");
      expect(readmeContent).toContain("./docs/compatibility.md");
      expect(readmeContent).toContain("./docs/versioning.md");
      expect(readmeContent).toContain("./docs/upgrade-guardrails.md");
      expect(readmeContent).toContain("./docs/errors.md");
      expect(readmeContent).toContain("./docs/security.md");
      expect(readmeContent).toContain("./docs/artifacts.md");
    });

    it("all documentation files in docs/ should exist", () => {
      const expectedFiles = [
        "compatibility.md",
        "versioning.md",
        "upgrade-guardrails.md",
        "errors.md",
        "security.md",
        "artifacts.md",
      ];
      for (const file of expectedFiles) {
        expect(fs.existsSync(path.join(docsDir, file))).toBe(true);
      }
    });

    it("documentation section headings across all markdown files should not use numerical prefixes", () => {
      const docFiles = [
        path.join(rootDir, "README.md"),
        path.join(rootDir, "COMPATIBILITY.md"),
        path.join(rootDir, "astro/README.md"),
        path.join(rootDir, "vite/README.md"),
        path.join(rootDir, "vite-plus/README.md"),
        path.join(rootDir, "lint-format/README.md"),
        ...fs.readdirSync(docsDir).map((f) => path.join(docsDir, f)),
      ];

      const numericalHeadingRegex = /^#{1,6}\s+\d+[\.\)]\s+/m;
      for (const filePath of docFiles) {
        const content = fs.readFileSync(filePath, "utf8");
        expect(content).not.toMatch(numericalHeadingRegex);
      }
    });
  });

  describe("Public Action API Contract Consistency", () => {
    validateAllPublicActionContracts(rootDir);

    it.each(["astro", "vite", "vite-plus", "lint-format"] as const)(
      "action '%s' README.md should document all inputs and outputs from action.yml",
      (actionName) => {
        const actionReadmePath = path.join(rootDir, actionName, "README.md");

        const contract = parseActionContract(actionName, rootDir);
        const actionReadme = fs.readFileSync(actionReadmePath, "utf8");

        for (const input of contract.inputs) {
          expect(actionReadme).toContain(`\`${input.name}\``);
          expect(readmeContent).toContain(`\`${input.name}\``);
        }

        for (const output of contract.outputs) {
          expect(actionReadme).toContain(`\`${output.name}\``);
          expect(readmeContent).toContain(`\`${output.name}\``);
        }
      },
    );
  });

  describe("Compatibility Documentation Consistency", () => {
    const docCompatContent = fs.readFileSync(path.join(docsDir, "compatibility.md"), "utf8");

    it("should document all canonical supported runtimes", () => {
      for (const runtime of CANONICAL_COMPATIBILITY_MODEL.runtimes) {
        expect(docCompatContent.toLowerCase()).toContain(runtime.toLowerCase());
        expect(compatibilityContent.toLowerCase()).toContain(runtime.toLowerCase());
      }
    });

    it("should document all canonical supported package managers", () => {
      for (const pm of CANONICAL_COMPATIBILITY_MODEL.packageManagers) {
        expect(docCompatContent.toLowerCase()).toContain(pm.toLowerCase());
        expect(compatibilityContent.toLowerCase()).toContain(pm.toLowerCase());
      }
    });

    it("should document canonical matrix combinations without contradiction", () => {
      const supported = CANONICAL_COMPATIBILITY_MODEL.combinations.filter((c) => c.supported);
      for (const comb of supported) {
        const pattern = `\`${comb.runtime}\`\\s*\\+\\s*\`${comb.packageManager}\``;
        expect(docCompatContent).toMatch(new RegExp(pattern, "i"));
        expect(compatibilityContent).toMatch(new RegExp(pattern, "i"));
      }

      const unsupported = CANONICAL_COMPATIBILITY_MODEL.combinations.filter((c) => !c.supported);
      for (const comb of unsupported) {
        const pattern = `\`${comb.runtime}\`\\s*\\+\\s*\`${comb.packageManager}\``;
        expect(docCompatContent).toMatch(new RegExp(pattern, "i"));
        expect(compatibilityContent).toMatch(new RegExp(pattern, "i"));
      }
    });

    it("should accurately document canonical default versions", () => {
      expect(docCompatContent).toContain(DEFAULT_NODE_VERSION);
      expect(docCompatContent).toContain(DEFAULT_BUN_VERSION);
      expect(docCompatContent).toContain(DEFAULT_NPM_VERSION);
      expect(docCompatContent).toContain(DEFAULT_PNPM_VERSION);

      expect(compatibilityContent).toContain(DEFAULT_NODE_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_BUN_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_NPM_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_PNPM_VERSION);
    });
  });

  describe("Versioning Documentation Consistency", () => {
    const docVersioningContent = fs.readFileSync(path.join(docsDir, "versioning.md"), "utf8");

    it("should document package.json as authoritative source of truth", () => {
      expect(docVersioningContent).toContain("package.json");
      expect(docVersioningContent.toLowerCase()).toContain("authoritative");

      expect(compatibilityContent).toContain("package.json");
      expect(compatibilityContent.toLowerCase()).toContain("authoritative");
    });

    it("should document SemVer change impact categories (patch, minor, major)", () => {
      expect(docVersioningContent).toContain("Patch Releases");
      expect(docVersioningContent).toContain("Minor Releases");
      expect(docVersioningContent).toContain("Major Releases");
    });
  });

  describe("Upgrade Guardrails Documentation Consistency", () => {
    const docGuardrailsContent = fs.readFileSync(
      path.join(docsDir, "upgrade-guardrails.md"),
      "utf8",
    );

    it("should document baseline resolution candidate chain", () => {
      const requiredRefs = [
        "baseRef",
        "UPGRADE_BASE_REF",
        "BASE_REF",
        "GITHUB_BASE_REF",
        "GITHUB_EVENT_BEFORE",
        "origin/main",
        "main",
      ];
      for (const ref of requiredRefs) {
        expect(docGuardrailsContent).toContain(ref);
      }
    });

    it("should explicitly prohibit contract guessing via HEAD~1", () => {
      expect(docGuardrailsContent).toContain("HEAD~1");
      expect(docGuardrailsContent.toLowerCase()).toContain("prohibited");
    });
  });

  describe("Error, Security & Artifact Integrity Documentation Consistency", () => {
    it("docs/errors.md should document all WorkflowErrorCode enum values", () => {
      const docErrorsContent = fs.readFileSync(path.join(docsDir, "errors.md"), "utf8");
      const codes = [
        "INVALID_INPUT",
        "UNSUPPORTED_RUNTIME_OR_PM",
        "UNSUPPORTED_COMBINATION",
        "MISSING_CONFIGURATION",
        "SETUP_FAILURE",
        "COMMAND_EXECUTION_FAILURE",
      ];
      for (const code of codes) {
        expect(docErrorsContent).toContain(code);
      }
    });

    it("docs/security.md should document command tokenization and credential sanitization", () => {
      const docSecurityContent = fs.readFileSync(path.join(docsDir, "security.md"), "utf8");
      expect(docSecurityContent).toContain("sanitizeCommandString");
      expect(docSecurityContent.toLowerCase()).toContain("subshell");
    });

    it("docs/artifacts.md should document source to dist build policy and verification command", () => {
      const docArtifactsContent = fs.readFileSync(path.join(docsDir, "artifacts.md"), "utf8");
      expect(docArtifactsContent).toContain("npm run build");
      expect(docArtifactsContent).toContain("npm run verify:artifacts");
      expect(docArtifactsContent).toContain("src/");
      expect(docArtifactsContent).toContain("dist/");
    });
  });
});
