import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("Documentation Consistency Verification", () => {
  const rootDir = path.resolve(process.cwd());
  const readmeContent = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
  const docsDir = path.join(rootDir, "docs");

  describe("Documentation Architecture & Navigation", () => {
    it("README.md should exist and contain main entry point usage and action navigation", () => {
      expect(readmeContent).toContain("area44/workflows");
      expect(readmeContent).toContain("Composite Actions");
      expect(readmeContent).toContain("Quick Usage");
      expect(readmeContent).toContain("Public Action API Summary");
      expect(readmeContent).toContain("Documentation Architecture");
    });

    it("README.md should link to all specialized docs files", () => {
      expect(readmeContent).toContain("./docs/errors.md");
      expect(readmeContent).toContain("./docs/security.md");
    });

    it("all documentation files in docs/ should exist", () => {
      const expectedFiles = [
        "errors.md",
        "security.md",
      ];
      for (const file of expectedFiles) {
        expect(fs.existsSync(path.join(docsDir, file))).toBe(true);
      }
    });

    it("documentation section headings across all markdown files should not use numerical prefixes", () => {
      const docFiles = [
        path.join(rootDir, "README.md"),
        path.join(rootDir, "astro/README.md"),
        path.join(rootDir, "vite/README.md"),
        path.join(rootDir, "autofix/README.md"),
        ...fs.readdirSync(docsDir).map((f) => path.join(docsDir, f)),
      ];

      const numericalHeadingRegex = /^#{1,6}\s+\d+[\.\)]\s+/m;
      for (const filePath of docFiles) {
        const content = fs.readFileSync(filePath, "utf8");
        expect(content).not.toMatch(numericalHeadingRegex);
      }
    });
  });

  describe("Error & Security Documentation Consistency", () => {
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
  });
});
