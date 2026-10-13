import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import yaml from "yaml";

describe("Changesets Release Architecture and Workflow", () => {
  const rootDir = path.resolve(process.cwd());

  describe("Changeset Configuration (.changeset/config.json)", () => {
    it(".changeset/config.json should exist and be valid JSON", () => {
      const configPath = path.join(rootDir, ".changeset", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(content);

      expect(config.baseBranch).toBe("main");
      expect(config.privatePackages).toEqual({
        version: true,
        tag: true,
      });
    });
  });

  describe("Package Manifest Changeset Scripts", () => {
    it("package.json should define changeset, version, and release scripts", () => {
      const pkgPath = path.join(rootDir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts.changeset).toBe("changeset");
      expect(pkg.scripts.version).toContain("changeset version");
      expect(pkg.scripts.version).toContain("npm run build");
      expect(pkg.scripts.release).toBe("changeset git-tag");
    });

    it("package.json should remain a private package with single unified versioning", () => {
      const pkgPath = path.join(rootDir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

      expect(pkg.name).toBe("@area44/workflows");
      expect(pkg.private).toBe(true);
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("Automated Release Workflow (.github/workflows/release.yml)", () => {
    const releaseWorkflowPath = path.join(rootDir, ".github", "workflows", "release.yml");

    it("release.yml should exist and parse as valid YAML", () => {
      expect(fs.existsSync(releaseWorkflowPath)).toBe(true);
      const content = fs.readFileSync(releaseWorkflowPath, "utf8");
      const parsed = yaml.parse(content);

      expect(parsed.name).toBe("Release");
      expect(parsed.on.push.branches).toContain("main");
    });

    it("release.yml should declare concurrency and minimum permissions", () => {
      const content = fs.readFileSync(releaseWorkflowPath, "utf8");
      const parsed = yaml.parse(content);

      expect(parsed.concurrency).toBeDefined();
      expect(parsed.permissions).toEqual({
        contents: "write",
        "pull-requests": "write",
      });
    });

    it("release.yml should pin third-party actions to commit SHAs and configure changesets/action", () => {
      const content = fs.readFileSync(releaseWorkflowPath, "utf8");
      const parsed = yaml.parse(content);

      const releaseJob = parsed.jobs.release;
      expect(releaseJob).toBeDefined();

      const steps = releaseJob.steps;
      const changesetStep = steps.find((s: any) => s.id === "changesets");
      expect(changesetStep).toBeDefined();
      expect(changesetStep.uses).toMatch(/^changesets\/action@[a-f0-9]{40}/);
      expect(changesetStep.with.version).toBe("npm run version");
      expect(changesetStep.with.publish).toBe("npm run release");
    });
  });

  describe("PR Changeset Enforcement Logic", () => {
    function evaluatePRChangesetRequirement(changedFiles: string[]): {
      requiresChangeset: boolean;
      nonDocFiles: string[];
      changesetFiles: string[];
    } {
      const nonDocFiles = changedFiles.filter(
        (f) => !f.startsWith(".changeset/") && !f.startsWith("docs/") && !f.endsWith(".md"),
      );
      const changesetFiles = changedFiles.filter(
        (f) => f.startsWith(".changeset/") && f.endsWith(".md"),
      );

      const requiresChangeset = nonDocFiles.length > 0 && changesetFiles.length === 0;

      return {
        requiresChangeset,
        nonDocFiles,
        changesetFiles,
      };
    }

    it("should NOT require changeset for documentation-only changes", () => {
      const docFiles = ["README.md", "docs/maintenance.md", "docs/security.md"];
      const result = evaluatePRChangesetRequirement(docFiles);
      expect(result.requiresChangeset).toBe(false);
      expect(result.nonDocFiles).toHaveLength(0);
    });

    it("should REQUIRE changeset when source files are modified without a changeset", () => {
      const codeFiles = ["src/resolve-environment.ts", "package.json"];
      const result = evaluatePRChangesetRequirement(codeFiles);
      expect(result.requiresChangeset).toBe(true);
      expect(result.nonDocFiles).toEqual(codeFiles);
    });

    it("should PASS when source files are modified WITH a changeset file", () => {
      const mixedFiles = [
        "src/resolve-environment.ts",
        ".changeset/friendly-pandas-dance.md",
      ];
      const result = evaluatePRChangesetRequirement(mixedFiles);
      expect(result.requiresChangeset).toBe(false);
      expect(result.changesetFiles).toHaveLength(1);
    });
  });
});
