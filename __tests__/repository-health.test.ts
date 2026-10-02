import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  runHealthVerification,
  verifyRepositoryHealth,
} from "../src/resolve-environment";

describe("Repository Health Verification", () => {
  const realRootDir = path.resolve(process.cwd());

  describe("Real Workspace Health Verification", () => {
    it("should pass health verification for the real repository workspace", () => {
      const result = verifyRepositoryHealth(realRootDir, { checkGitStatus: false });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.publicActions).toEqual(["astro", "vite", "vite-plus", "lint-format"]);
      expect(result.artifactsVerified).toBe(true);
      expect(result.orphanDocs).toEqual([]);
      expect(result.orphanFixtures).toEqual([]);
    });

    it("runHealthVerification entrypoint should run without throwing in valid workspace", () => {
      expect(() => runHealthVerification(realRootDir, { checkGitStatus: false })).not.toThrow();
    });
  });

  describe("Negative Regression Tests (Simulated Health Failures)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-health-test-"));
      copyValidRepoStructure(realRootDir, tmpDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should fail when a required root file (package.json) is missing", () => {
      fs.rmSync(path.join(tmpDir, "package.json"));
      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Missing required root repository file: package.json")),
      ).toBe(true);
    });

    it("should fail when a required root file (.github/workflows/ci.yml) is missing", () => {
      fs.rmSync(path.join(tmpDir, ".github/workflows/ci.yml"));
      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes("Missing required root repository file: .github/workflows/ci.yml"),
        ),
      ).toBe(true);
    });

    it("should fail when a public action is missing required action.yml file", () => {
      fs.rmSync(path.join(tmpDir, "astro/action.yml"));
      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Public action 'astro' is missing action.yml")),
      ).toBe(true);
    });

    it("should fail when a public action is missing required README.md file", () => {
      fs.rmSync(path.join(tmpDir, "vite/README.md"));
      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("Public action 'vite' is missing README.md")),
      ).toBe(true);
    });

    it("should fail when an unexpected public action directory is present in root", () => {
      const unexpectedDir = path.join(tmpDir, "unknown-custom-action");
      fs.mkdirSync(unexpectedDir, { recursive: true });
      fs.writeFileSync(
        path.join(unexpectedDir, "action.yml"),
        "name: Custom Action\ndescription: Unexpected\nruns:\n  using: composite\n",
      );

      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes(
            "Unexpected public action directory found in repository root: 'unknown-custom-action'",
          ),
        ),
      ).toBe(true);
    });

    it("should fail when an action.yml references a non-existent artifact file", () => {
      const astroActionYml = path.join(tmpDir, "astro/action.yml");
      const content = fs.readFileSync(astroActionYml, "utf8");
      fs.writeFileSync(
        astroActionYml,
        content + "\n    - run: node \"$ACTION_PATH/../dist/non-existent-module.mjs\"\n",
      );

      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes("references non-existent artifact file: dist/non-existent-module.mjs"),
        ),
      ).toBe(true);
    });

    it("should fail when an unlinked orphan documentation file exists in docs/", () => {
      const orphanDocPath = path.join(tmpDir, "docs/orphan-unlinked-guide.md");
      fs.writeFileSync(orphanDocPath, "# Unlinked Guide\nSome text.\n");

      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes("Orphan documentation file detected in docs/: 'orphan-unlinked-guide.md'"),
        ),
      ).toBe(true);
    });

    it("should fail when package.json version and package-lock.json version are out of sync", () => {
      const pkgPath = path.join(tmpDir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      pkg.version = "9.9.9";
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

      const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Version synchronization failure"))).toBe(true);
    });

    describe("CI Invariant Validation Regressions", () => {
      it("should pass when required command actually exists in step.run", () => {
        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.valid).toBe(true);
      });

      it("should fail when required command only appears in a comment inside step.run", () => {
        const ciPath = path.join(tmpDir, ".github/workflows/ci.yml");
        let ciContent = fs.readFileSync(ciPath, "utf8");
        ciContent = ciContent.replace("run: npm run verify:health", "run: |\n          # npm run verify:health");
        fs.writeFileSync(ciPath, ciContent);

        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) =>
            e.includes(
              "CI workflow .github/workflows/ci.yml is missing required execution step running: 'npm run verify:health'",
            ),
          ),
        ).toBe(true);
      });

      it("should fail when required command appears in step name or text field but not in step.run", () => {
        const ciPath = path.join(tmpDir, ".github/workflows/ci.yml");
        let ciContent = fs.readFileSync(ciPath, "utf8");
        ciContent = ciContent.replace(
          "name: Verify repository health\n        run: npm run verify:health",
          "name: Verify repository health (npm run verify:health)\n        run: echo 'running health'",
        );
        fs.writeFileSync(ciPath, ciContent);

        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) =>
            e.includes(
              "CI workflow .github/workflows/ci.yml is missing required execution step running: 'npm run verify:health'",
            ),
          ),
        ).toBe(true);
      });
    });

    describe("Orphan Fixtures Reporting Regressions", () => {
      it("should report orphanFixtures as empty array [] for valid repository", () => {
        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.valid).toBe(true);
        expect(result.orphanFixtures).toEqual([]);
      });

      it("should accurately detect orphanFixtures and record errors when an unused fixture leaf directory exists", () => {
        const orphanFixtureDir = path.join(
          tmpDir,
          "__tests__/fixtures/astro/node/npm/unreferenced-extra",
        );
        fs.mkdirSync(orphanFixtureDir, { recursive: true });
        fs.writeFileSync(
          path.join(orphanFixtureDir, "package.json"),
          '{"name": "orphan-test"}',
        );

        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.valid).toBe(false);
        const expectedRelPath = path.normalize(
          "__tests__/fixtures/astro/node/npm/unreferenced-extra",
        );
        expect(result.orphanFixtures).toContain(expectedRelPath);
        expect(
          result.errors.some((e) => e.includes(`Unused fixture directory detected: ${expectedRelPath}`)),
        ).toBe(true);
      });

      it("should not report referenced matrix fixtures as orphanFixtures", () => {
        const result = verifyRepositoryHealth(tmpDir, { checkGitStatus: false });
        expect(result.orphanFixtures).toEqual([]);
        const knownFixture = path.normalize("__tests__/fixtures/astro/node/npm/basic");
        expect(result.orphanFixtures).not.toContain(knownFixture);
      });
    });
  });
});

function copyValidRepoStructure(srcDir: string, destDir: string): void {
  const filesToCopy = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "AGENTS.md",
    "COMPATIBILITY.md",
    "README.md",
  ];

  for (const f of filesToCopy) {
    const s = path.join(srcDir, f);
    if (fs.existsSync(s)) {
      fs.copyFileSync(s, path.join(destDir, f));
    }
  }

  const dirsToCopy = [
    ".github",
    "astro",
    "vite",
    "vite-plus",
    "lint-format",
    "docs",
    "dist",
    "src",
    "__tests__",
  ];

  for (const d of dirsToCopy) {
    const s = path.join(srcDir, d);
    if (fs.existsSync(s)) {
      copyRecursiveSync(s, path.join(destDir, d));
    }
  }
}

function copyRecursiveSync(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}
