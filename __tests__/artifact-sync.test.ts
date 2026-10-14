import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { PUBLIC_ACTIONS } from "../src/action-contract";

describe("Autofix & Action Source/Artifact Synchronization", () => {
  const rootDir = path.resolve(process.cwd());
  const distDir = path.join(rootDir, "dist");
  const srcDir = path.join(rootDir, "src");

  describe("Artifact and Entrypoint Reference Invariants", () => {
    it("vite.config.ts should define pack entries for all core workflow scripts", () => {
      const viteConfigPath = path.join(rootDir, "vite.config.ts");
      expect(fs.existsSync(viteConfigPath)).toBe(true);

      const viteConfigContent = fs.readFileSync(viteConfigPath, "utf8");
      const expectedEntries = [
        "resolve-environment",
        "autofix",
        "site-variables",
        "build-command",
      ];

      for (const entry of expectedEntries) {
        expect(viteConfigContent).toContain(`"${entry}"`);
        expect(fs.existsSync(path.join(srcDir, `${entry}.ts`))).toBe(true);
        expect(fs.existsSync(path.join(distDir, `${entry}.mjs`))).toBe(true);
      }
    });

    it("all composite action.yml files should reference existing dist/*.mjs artifacts", () => {
      for (const actionName of PUBLIC_ACTIONS) {
        const actionYmlPath = path.join(rootDir, actionName, "action.yml");
        expect(fs.existsSync(actionYmlPath)).toBe(true);

        const content = fs.readFileSync(actionYmlPath, "utf8");
        const mjsMatches = content.match(/dist\/[a-zA-Z0-9_-]+\.mjs/g) || [];
        expect(mjsMatches.length).toBeGreaterThan(0);

        for (const match of mjsMatches) {
          const artifactName = path.basename(match);
          const artifactPath = path.join(distDir, artifactName);
          expect(fs.existsSync(artifactPath)).toBe(true);
        }
      }
    });

    it("autofix/action.yml execution paths should specifically reference resolve-environment.mjs and autofix.mjs", () => {
      const autofixYmlPath = path.join(rootDir, "autofix/action.yml");
      const content = fs.readFileSync(autofixYmlPath, "utf8");

      expect(content).toContain("dist/resolve-environment.mjs");
      expect(content).toContain("dist/autofix.mjs");
    });
  });

  describe("Source-to-Artifact Zero Drift Invariant", () => {
    it("committed dist/*.mjs files should be byte-for-byte up-to-date with src/*.ts build output", () => {
      const expectedArtifacts = [
        "resolve-environment.mjs",
        "autofix.mjs",
        "site-variables.mjs",
        "build-command.mjs",
      ];

      const initialContents = new Map<string, string>();
      for (const artifact of expectedArtifacts) {
        const artifactPath = path.join(distDir, artifact);
        expect(fs.existsSync(artifactPath)).toBe(true);
        initialContents.set(artifact, fs.readFileSync(artifactPath, "utf8"));
      }

      execSync("npm run build", { cwd: rootDir, stdio: "pipe" });

      for (const artifact of expectedArtifacts) {
        const artifactPath = path.join(distDir, artifact);
        const freshContent = fs.readFileSync(artifactPath, "utf8");
        const initialContent = initialContents.get(artifact);

        expect(
          freshContent,
          `Artifact "dist/${artifact}" is out of sync with source files in "src/". Please run "npm run build" and commit the updated "dist/${artifact}".`,
        ).toBe(initialContent);
      }
    });
  });
});
