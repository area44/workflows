import { createConsumerProject } from "../.github/scripts/generate-consumer-project.js";
import os from "node:os";
import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ResolvedEnvironment } from "../src/resolve-environment.js";
import {
  createSetupPlan,
  logResolvedEnvironment,
  resolveEnvironment,
  run,
  validateEnvironment,
  writeOutput,
} from "../src/resolve-environment.js";

vi.mock("@actions/core");

describe("resolve-environment", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  const fixturesDir = os.tmpdir();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("Aggregate Environment Validation (validateEnvironment)", () => {
    function createValidEnvironment(): ResolvedEnvironment {
      return {
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "npm" },
          toolchain: undefined,
        },
        python: {
          detected: true,
          packageManager: {
            name: "uv",
            execPrefix: "uv run",
            lockfile: "uv.lock",
            configFile: "pyproject.toml",
            installCommands: [{ executable: "uv", args: ["sync"] }],
            isStandalone: false,
          },
        },
      };
    }

    it("should validate a complete and valid aggregate environment", () => {
      const valid = createValidEnvironment();
      expect(validateEnvironment(valid)).toEqual(valid);
    });

    it("should validate a valid Python environment with packageManager: null when detected is false", () => {
      const valid = createValidEnvironment();
      valid.python.detected = false;
      valid.python.packageManager = null;
      expect(validateEnvironment(valid)).toEqual(valid);
    });

    it("should reject detected: false with non-null packageManager", () => {
      const env = createValidEnvironment();
      env.python.detected = false;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "packageManager" must be null when detected is false',
      );
    });

    it("should reject detected: true with packageManager: null", () => {
      const env = createValidEnvironment();
      env.python.detected = true;
      env.python.packageManager = null;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "packageManager" cannot be null when detected is true',
      );
    });

    it("should reject missing packageManager property", () => {
      const env = createValidEnvironment();
      delete (env.python as any).packageManager;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "packageManager" property is required',
      );
    });

    it("should reject explicit packageManager: undefined", () => {
      const env = createValidEnvironment();
      (env.python as any).packageManager = undefined;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "packageManager" property is required',
      );
    });

    it.each([123, "uv", true, [1, 2, 3]])(
      "should reject invalid primitive or array value for packageManager: %p",
      (invalidPmInfo) => {
        const env = createValidEnvironment();
        (env.python as any).packageManager = invalidPmInfo;
        expect(() => validateEnvironment(env)).toThrow(
          'Invalid Python environment: "pmInfo" must be an object when present',
        );
      },
    );

    it.each(["poetry", "npm", "pipenv", "", "PIP"])(
      "should reject invalid package manager name in packageManager: %p",
      (invalidName) => {
        const env = createValidEnvironment();
        (env.python.packageManager as any).name = invalidName;
        expect(() => validateEnvironment(env)).toThrow(
          'Invalid Python environment: pmInfo name must be "uv" or "pip"',
        );
      },
    );

    it("should validate legitimate resolver output for standalone Python source without manifest", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "standalone-pm-val-"));
      fs.writeFileSync(path.join(tempDir, "script.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.python.detected).toBe(true);
        expect(env.python.packageManager).toMatchObject({
          name: "pip",
          installCommands: [],
          execPrefix: "",
          isStandalone: true,
        });

        expect(() => validateEnvironment(env)).not.toThrow();
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw error for non-object environment", () => {
      expect(() => validateEnvironment(null as any)).toThrow(
        "Invalid environment: must be a non-null object",
      );
    });

    it("should throw error for missing or invalid javascript section", () => {
      const env = createValidEnvironment();
      delete (env as any).javascript;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid environment: missing or invalid "javascript" section',
      );
    });

    it("should throw error for missing or invalid python section", () => {
      const env = createValidEnvironment();
      delete (env as any).python;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid environment: missing or invalid "python" section',
      );
    });

    it("should throw error for non-boolean detected in javascript section", () => {
      const env = createValidEnvironment();
      (env.javascript as any).detected = "true";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid JavaScript environment: "detected" must be a boolean',
      );
    });

    it("should throw error for invalid runtime in javascript section", () => {
      const env = createValidEnvironment();
      (env.javascript as any).runtime = "invalid-runtime";
      expect(() => validateEnvironment(env)).toThrow('Invalid JavaScript environment: "runtime" must be an object');

      const env2 = createValidEnvironment();
      (env2.javascript.runtime as any).name = "invalid-runtime";
      expect(() => validateEnvironment(env2)).toThrow('Invalid resolved runtime: "invalid-runtime"');
    });

    it("should throw error for invalid or missing package manager in javascript section", () => {
      const env = createValidEnvironment();
      (env.javascript as any).packageManager = { name: "" };
      expect(() => validateEnvironment(env)).toThrow("Invalid resolved package manager");
    });

    it("should throw error for invalid toolchain in javascript section", () => {
      const env = createValidEnvironment();
      (env.javascript as any).toolchain = "webpack";
      expect(() => validateEnvironment(env)).toThrow('Invalid resolved toolchain: "webpack"');
    });

    it("should throw error for non-boolean detected in python section", () => {
      const env = createValidEnvironment();
      (env.python as any).detected = "yes";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "detected" must be a boolean',
      );
    });

    it("should throw error for invalid required packageManager string fields", () => {
      const env = createValidEnvironment();
      (env.python.packageManager as any).execPrefix = null;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.execPrefix" must be a string',
      );
    });

    it("should reject legacy installCommand supplied without installCommands", () => {
      const env = createValidEnvironment();
      delete (env.python.packageManager as any).installCommands;
      (env.python.packageManager as any).installCommand = "uv sync";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.installCommands" must be an array',
      );
    });

    it("should throw error for invalid optional string or boolean fields in packageManager", () => {
      const env = createValidEnvironment();
      (env.python.packageManager as any).lockfile = 456;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.lockfile" must be a string',
      );

      const env2 = createValidEnvironment();
      (env2.python.packageManager as any).isStandalone = "false";
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "pmInfo.isStandalone" must be a boolean',
      );
    });

    it("should reject inconsistent standalone metadata in packageManager", () => {
      const env1 = createValidEnvironment();
      env1.python.packageManager!.isStandalone = true;
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: standalone "pmInfo" must have empty installCommands array',
      );

      const env2 = createValidEnvironment();
      env2.python.packageManager!.isStandalone = true;
      env2.python.packageManager!.installCommands = [];
      env2.python.packageManager!.lockfile = "uv.lock";
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: standalone "pmInfo" cannot specify lockfile or configFile',
      );
    });

    it("should reject inconsistent UV lockfile metadata in packageManager", () => {
      const env1 = createValidEnvironment();
      env1.python.packageManager!.name = "uv";
      env1.python.packageManager!.lockfile = "invalid.lock";
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: UV lockfile name must be "uv.lock" when present',
      );

      const env2 = createValidEnvironment();
      env2.python.packageManager!.name = "uv";
      env2.python.packageManager!.lockfile = "uv.lock";
      delete env2.python.packageManager!.configFile;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: UV lockfile requires configFile "pyproject.toml"',
      );
    });

    it("should throw error for malformed installCommands in packageManager", () => {
      const env = createValidEnvironment();
      (env.python.packageManager as any).installCommands = "uv sync";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.installCommands" must be an array',
      );

      const env2 = createValidEnvironment();
      (env2.python.packageManager as any).installCommands = [{ executable: "uv", args: "sync" }];
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );

      const env3 = createValidEnvironment();
      (env3.python.packageManager as any).installCommands = [{ executable: "", args: ["sync"] }];
      expect(() => validateEnvironment(env3)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );

      const env4 = createValidEnvironment();
      (env4.python.packageManager as any).installCommands = [{ executable: "uv", args: [123] }];
      expect(() => validateEnvironment(env4)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );
    });
  });

  describe("Scenario Matrix Verification", () => {
    it("Python-only project with stray .nvmrc and .bun-version files", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-py-stray-js-"));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");
      fs.writeFileSync(path.join(tempDir, ".nvmrc"), "20.10.0\n");
      fs.writeFileSync(path.join(tempDir, ".bun-version"), "1.2.0\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(false);
        expect(env.python.detected).toBe(true);

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports JavaScript outputs when only a JavaScript project is detected", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-js-only-"));
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "js-app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(true);
        expect(env.python.detected).toBe(false);

        expect(core.info).toHaveBeenCalledWith("Runtime: Node.js");
        expect(core.info).toHaveBeenCalledWith("Package Manager: npm");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Toolchain:"));

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Python outputs when only a Python project is detected", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-py-only-"));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(false);
        expect(env.python.detected).toBe(true);

        expect(core.info).toHaveBeenCalledWith("Runtime: Python");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pip");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("resolves both environments independently when both projects are present", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-both-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "dual-app", packageManager: "pnpm@9.0.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'dual-app'\n");
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(true);
        expect(env.python.detected).toBe(true);

        expect(core.info).toHaveBeenCalledWith("Runtime: Node.js, Python");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pnpm, uv");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "uv");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("uses default configuration when neither project is detected", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-neither-"));
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Empty Repo\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(false);
        expect(env.python.detected).toBe(false);

        expect(core.info).toHaveBeenCalledWith(
          "No JavaScript or Python environment detected.",
        );

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Node.js and npm outputs correctly", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-node-npm-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "node-npm-app", packageManager: "npm@12.0.0" }),
      );

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.name).toBe("node");
        expect(env.javascript.packageManager).toMatchObject({ name: "npm" });
        expect(core.info).toHaveBeenCalledWith("Runtime: Node.js");
        expect(core.info).toHaveBeenCalledWith("Package Manager: npm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Node.js and pnpm outputs correctly", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-node-pnpm-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "node-pnpm-app", packageManager: "pnpm@9.5.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.name).toBe("node");
        expect(env.javascript.packageManager).toMatchObject({ name: "pnpm" });
        expect(core.info).toHaveBeenCalledWith("Runtime: Node.js");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Bun and its package manager correctly", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-bun-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "bun-app", packageManager: "bun@1.4.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.name).toBe("bun");
        expect(env.javascript.packageManager).toMatchObject({ name: "bun" });
        expect(core.info).toHaveBeenCalledWith("Runtime: Bun");
        expect(core.info).toHaveBeenCalledWith("Package Manager: bun");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Bun runtime and Vite+ toolchain outputs correctly when Bun runtime is selected with Vite+", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-bun-vite-plus-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "bun-vp-app",
          packageManager: "bun@1.4.0",
          devDependencies: { "@voidzero-dev/vite-plus": "^1.4.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.name).toBe("bun");
        expect(env.javascript.toolchain).toBe("vite-plus");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "bun");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-toolchain", "vite-plus");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Python and uv outputs correctly", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-py-uv-"));
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'py-uv-app'\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.python.detected).toBe(true);
        expect(env.python.packageManager?.name).toBe("uv");
        expect(core.info).toHaveBeenCalledWith("Runtime: Python");
        expect(core.info).toHaveBeenCalledWith("Package Manager: uv");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "uv");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("reports Python and pip outputs correctly", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-py-pip-"));
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests>=2.0.0\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.python.detected).toBe(true);
        expect(env.python.packageManager?.name).toBe("pip");
        expect(core.info).toHaveBeenCalledWith("Runtime: Python");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pip");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("preserves validation and failure behavior for malformed project configuration", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-malformed-config-"));
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), ""); // missing pyproject.toml

      process.chdir(tempDir);
      try {
        expect(() => resolveEnvironment()).toThrow(
          /Invalid Python project configuration: 'uv.lock' was detected without a valid 'pyproject.toml'/,
        );
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Environment Resolution Pipeline", () => {
    describe("Pipeline Determinism", () => {
      it("should produce identical resolved environment given identical inputs and project state", () => {
        vi.spyOn(fs, "existsSync").mockImplementation((p) =>
          ["package-lock.json"].includes(p as string),
        );

        const run1 = resolveEnvironment();
        const run2 = resolveEnvironment();

        expect(run1).toEqual(run2);
        expect(run1.javascript.packageManager).toMatchObject({ name: "npm" });
        expect(run1.javascript.runtime.name).toBe("node");
        expect(run1.javascript.toolchain).toBeUndefined();
        expect(run1.python.detected).toBe(false);
      });
    });
  });

  describe("Setup Planning Integration", () => {
    it("createSetupPlan creates plan from environment without side effects", () => {
      const existsSpy = vi.spyOn(fs, "existsSync");
      const readSpy = vi.spyOn(fs, "readFileSync");

      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
          toolchain: "vite-plus",
        },
        python: {
          detected: false,
          packageManager: null,
        },
      };

      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(false);
      expect(plan.pnpm.shouldSetup).toBe(true);

      expect(existsSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe("Fixture-based tests", () => {
    const cases = [
      {
        action: "pages",
        runtime: "node",
        pm: "npm@11.19.0",
        type: "basic",
        expectedPm: { name: "npm" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "minimal",
        expectedPm: { name: "npm" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedPm: { name: "pnpm" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun@1.4",
        type: "basic",
        expectedPm: { name: "bun" },
        expectedRuntime: "bun",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "npm@11.19.0",
        type: "basic",
        expectedPm: { name: "npm" },
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should resolve correct environment for fixture $action/$runtime/$pm/$type",
      ({ action, runtime: rt, pm, type, expectedPm, expectedRuntime }) => {
        const scenarioPath = fs.mkdtempSync(path.join(fixturesDir, `res-env-${action}-${rt}-${type}-`));
        createConsumerProject(scenarioPath, { action, runtime: rt, pm, type });
        process.chdir(scenarioPath);

        try {
          const env = resolveEnvironment();

          expect(env.javascript.packageManager).toMatchObject(expectedPm);
          expect(env.javascript.runtime.name).toBe(expectedRuntime);
        } finally {
          process.chdir(originalCwd);
          fs.rmSync(scenarioPath, { recursive: true, force: true });
        }
      },
    );
  });

  describe("writeOutput", () => {
    it("should consume env.javascript and env.python directly without re-inspecting filesystem", () => {
      const tempDir = path.join(fixturesDir, "write-output-no-reinspect-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        const existsSpy = vi.spyOn(fs, "existsSync");
        const readSpy = vi.spyOn(fs, "readFileSync");

        writeOutput(env);

        expect(existsSpy).not.toHaveBeenCalled();
        expect(readSpy).not.toHaveBeenCalled();
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should output package manager, runtime, and plan step outputs correctly for ResolvedEnvironment", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
          toolchain: "vite-plus",
        },
        python: {
          detected: false,
          packageManager: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should set python-detected and setup-python to false when no Python source files exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node" },
          packageManager: { name: "npm" },
          toolchain: undefined,
        },
        python: {
          detected: false,
          packageManager: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
      expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
    });
  });

  describe("run", () => {
    it("should coordinate environment resolution, execute setup plan, and write action output on fixture project", () => {
      const fixturePath = fs.mkdtempSync(path.join(fixturesDir, "pages-npm-basic-"));
      createConsumerProject(fixturePath, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });

    it("should resolve bun and set plan outputs for bun project fixture", () => {
      const fixturePath = fs.mkdtempSync(path.join(fixturesDir, "pages-bun-basic-"));
      createConsumerProject(fixturePath, { action: "pages", runtime: "bun", pm: "bun@1.4", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "bun");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });
  });

  describe("API Contract Consistency (Legacy Output Detection)", () => {
    it("should ensure public action definitions and README tables do not expose legacy output names", () => {
      const repoRoot = path.resolve(__dirname, "..");
      const pagesActionYml = fs.readFileSync(path.join(repoRoot, "pages/action.yml"), "utf8");
      const autofixActionYml = fs.readFileSync(path.join(repoRoot, "autofix/action.yml"), "utf8");
      const rootReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
      const pagesReadme = fs.readFileSync(path.join(repoRoot, "pages/README.md"), "utf8");
      const autofixReadme = fs.readFileSync(path.join(repoRoot, "autofix/README.md"), "utf8");

      const legacyNames = [
        "has-js-project",
        "has-python-source",
        "package-manager-version",
        "package-manager",
        "javascript-runtime-version",
        "javascript-package-manager-version",
        "python-version",
        "ruff-version",
      ];

      for (const legacyName of legacyNames) {
        // Check outputs section of pages/action.yml and autofix/action.yml
        expect(pagesActionYml, `pages/action.yml should not contain public output '${legacyName}'`).not.toMatch(
          new RegExp(`^\\s*${legacyName}:`, "m"),
        );
        expect(autofixActionYml, `autofix/action.yml should not contain public output '${legacyName}'`).not.toMatch(
          new RegExp(`^\\s*${legacyName}:`, "m"),
        );

        // Check documentation output tables
        expect(rootReadme, `README.md should not list legacy output '| \`${legacyName}\` |'`).not.toContain(
          `| \`${legacyName}\` |`,
        );
        expect(pagesReadme, `pages/README.md should not list legacy output '| \`${legacyName}\` |'`).not.toContain(
          `| \`${legacyName}\` |`,
        );
        expect(autofixReadme, `autofix/README.md should not list legacy output '| \`${legacyName}\` |'`).not.toContain(
          `| \`${legacyName}\` |`,
        );
      }
    });
  });

  describe("Log Formatting and Presentation Requirements (logResolvedEnvironment)", () => {
    it("Scenario 1: Single-environment resolution (JavaScript) formats plain consolidated lines without groups", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
          toolchain: "",
        },
        python: {
          detected: false,
          packageManager: null,
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenNthCalledWith(1, "Runtime: Node.js");
      expect(core.info).toHaveBeenNthCalledWith(2, "Package Manager: pnpm");
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Toolchain"));
    });

    it("Scenario 2: Single-environment resolution (Python) formats plain consolidated lines without groups", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node" },
          packageManager: { name: "npm" },
          toolchain: undefined,
        },
        python: {
          detected: true,
          packageManager: {
            name: "uv",
            execPrefix: "uv run",
            installCommands: [{ executable: "uv", args: ["sync"] }],
          },
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenNthCalledWith(1, "Runtime: Python");
      expect(core.info).toHaveBeenNthCalledWith(2, "Package Manager: uv");
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Ruff"));
    });

    it("Scenario 3: Multiple detected environments (JavaScript and Python) consolidates categories into single lines", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node" },
          packageManager: { name: "pnpm" },
          toolchain: "vite-plus",
        },
        python: {
          detected: true,
          packageManager: {
            name: "uv",
            execPrefix: "uv run",
            installCommands: [{ executable: "uv", args: ["sync"] }],
          },
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenNthCalledWith(1, "Runtime: Node.js, Python");
      expect(core.info).toHaveBeenNthCalledWith(2, "Package Manager: pnpm, uv");
      expect(core.info).toHaveBeenNthCalledWith(3, "Toolchain: Vite+");
    });

    it("Scenario 5: No supported environment detected logs concise message without groups or runtime lines", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node" },
          packageManager: { name: "npm" },
          toolchain: undefined,
        },
        python: {
          detected: false,
          packageManager: null,
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith("No JavaScript or Python environment detected.");
    });
  });
});
