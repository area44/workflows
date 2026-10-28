/**
 * Consumer Project Module Integration Suite
 *
 * Scope & Architecture:
 * This test suite validates module-level integration between domain modules in `src/`
 * (resolveEnvironment, resolveSiteVariables, resolveBuildCommandToParse, selectAutofixScripts)
 * against a dynamically generated consumer project fixture.
 *
 * Direct module imports are used here for fast local unit/component validation.
 * Full composite action-level execution is verified in CI via `.github/workflows/test-actions.yml`.
 */

import * as core from "@actions/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createConsumerProject } from "./helpers/consumer-project.js";
import {
  inspectJsProjectEnvironment,
  selectAutofixScripts,
} from "../src/javascript-env.js";
import {
  resolveBuildCommandToParse,
  resolveBuildOutputPath,
} from "../src/pages/build-command.js";
import { resolveSiteVariables, setSiteVariables } from "../src/pages/site-variables.js";
import { resolveEnvironment, writeOutput } from "../src/resolve-environment.js";

vi.mock("@actions/core");

describe("Consumer Project Module Integration Suite", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };

    // Create an isolated temporary working directory for each test and generate consumer project files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "consumer_integration_test_"));
    createConsumerProject(tempDir);
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Environment Resolution", () => {
    it("resolves full JS and Python environment for consumer project", () => {
      const env = resolveEnvironment();

      // JS Environment verification
      expect(env.js.hasJsProject).toBe(true);
      expect(env.js.pm).toMatchObject({ name: "npm", version: "10.8.2" });
      expect(env.js.runtime).toBe("node");
      expect(env.js.toolchain).toBe("vite");

      // Python Environment verification
      expect(env.python.hasPythonSource).toBe(true);
      expect(env.python.pmInfo?.name).toBe("pip");
      expect(env.python.pythonVersion).toBe("3.12");
      expect(env.python.ruffVersion).toBe("0.17.2");
    });

    it("writes canonical action outputs for consumer project", () => {
      const env = resolveEnvironment();
      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "true");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "10.8.2");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("toolchain", "vite");
      expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
      expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
      expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.17.2");
    });

    it("rejects incompatible runtime override (Bun runtime with npm lockfile) on consumer project", () => {
      expect(() => resolveEnvironment("bun@1.4")).toThrow(
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager",
      );
    });
  });

  describe("Site Variables Resolution", () => {
    it("resolves and sets SITE, BASE, and BASE_URL for consumer project repository", () => {
      process.env.GITHUB_REPOSITORY = "area44/consumer-project";
      process.env.GITHUB_REPOSITORY_OWNER = "area44";
      process.env.GITHUB_ACTION_PATH = "/runner/actions/pages";

      const vars = resolveSiteVariables(process.env);
      expect(vars).toEqual({
        site: "https://area44.github.io",
        base: "/consumer-project/",
      });

      setSiteVariables();
      expect(core.exportVariable).toHaveBeenCalledWith("SITE", "https://area44.github.io");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE", "/consumer-project/");
      expect(core.exportVariable).toHaveBeenCalledWith("BASE_URL", "/consumer-project/");
    });
  });

  describe("Build Command & Output Path Resolution", () => {
    it("resolves default build command and output path for consumer project", async () => {
      const env = resolveEnvironment();
      const buildCmd = await resolveBuildCommandToParse(
        undefined,
        undefined,
        env.js.pm.name,
      );

      expect(buildCmd).toBe("npm run build");

      const outputPath = resolveBuildOutputPath("");
      expect(outputPath).toBe("dist");
    });

    it("resolves custom build command and custom output path for consumer project", async () => {
      const env = resolveEnvironment();
      const buildCmd = await resolveBuildCommandToParse(
        "npm run custom-build",
        undefined,
        env.js.pm.name,
      );

      expect(buildCmd).toBe("npm run custom-build");

      const outputPath = resolveBuildOutputPath("  custom_build_dir/ ");
      expect(outputPath).toBe("custom_build_dir/");
    });
  });

  describe("Autofix Script Selection", () => {
    it("selects lint and format scripts defined in consumer package.json", () => {
      const env = resolveEnvironment();
      const scripts = selectAutofixScripts(env.js.project.packageJson?.scripts);
      expect(scripts).toEqual(["format", "lint"]);
    });
  });

  describe("Error Diagnostics & Edge Cases", () => {
    it("records packageJsonError when package.json is malformed JSON", () => {
      fs.writeFileSync("package.json", "{ malformed json content }");

      const project = inspectJsProjectEnvironment();
      expect(project.packageJsonError).toContain("Failed to parse package.json");
    });
  });
});
