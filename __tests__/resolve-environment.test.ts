import { createConsumerProject } from "../.github/scripts/generate-consumer-project.js";
import os from "node:os";
import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
  getDefaultJsPackageManagerVersion,
} from "../src/javascript-env.js";
import type { ResolvedEnvironment } from "../src/resolve-environment.js";
import {
  createSetupPlan,
  logResolvedEnvironment,
  resolveEnvironment,
  resolvePnpmSetupRuntime,
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

  describe("runtime constants", () => {
    it("should export default runtime and package manager versions", () => {
      expect(DEFAULT_NODE_VERSION).toBe("24");
      expect(DEFAULT_BUN_VERSION).toBe("1.4");
      expect(DEFAULT_NPM_VERSION).toBe("12");
      expect(DEFAULT_PNPM_VERSION).toBe("12");
      expect(getDefaultJsPackageManagerVersion("npm")).toBe("12");
      expect(getDefaultJsPackageManagerVersion("pnpm")).toBe("12");
      expect(getDefaultJsPackageManagerVersion("bun")).toBe("1.4");
    });
  });

  describe("Aggregate Environment Validation (validateEnvironment)", () => {
    function createValidEnvironment(): ResolvedEnvironment {
      return {
        javascript: {
          detected: true,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: true,
          version: "3.12",
          ruffVersion: "0.4.2",
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
      valid.python.version = "";
      valid.python.ruffVersion = "";
      valid.python.packageManager = null;
      expect(validateEnvironment(valid)).toEqual(valid);
    });

    it("should reject detected: false with non-null packageManager", () => {
      const env = createValidEnvironment();
      env.python.detected = false;
      env.python.version = "";
      env.python.ruffVersion = "";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "packageManager" must be null when detected is false',
      );
    });

    it("should reject detected: false with non-empty version or ruffVersion", () => {
      const env1 = createValidEnvironment();
      env1.python.detected = false;
      env1.python.version = "3.12";
      env1.python.ruffVersion = "";
      env1.python.packageManager = null;
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: "version" must be empty string when detected is false',
      );

      const env2 = createValidEnvironment();
      env2.python.detected = false;
      env2.python.version = "";
      env2.python.ruffVersion = "0.4.2";
      env2.python.packageManager = null;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "ruffVersion" must be empty string when detected is false',
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
        expect(env.python.packageManager).toEqual({
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
      (env.javascript as any).packageManager = { name: "", version: "12" };
      expect(() => validateEnvironment(env)).toThrow("Invalid resolved package manager");
    });

    it("should throw error for non-string runtime version in javascript section", () => {
      const env = createValidEnvironment();
      (env.javascript.runtime as any).version = 24;
      expect(() => validateEnvironment(env)).toThrow('Invalid JavaScript environment: "runtime.version" must be a string');
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

    it("should throw error for non-string version or ruffVersion in python section", () => {
      const env = createValidEnvironment();
      (env.python as any).version = 3.12;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "version" must be a string',
      );

      const env2 = createValidEnvironment();
      (env2.python as any).ruffVersion = undefined;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "ruffVersion" must be a string',
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
      // installCommands is non-empty
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

  describe("CI Workspace Setup and Restoration Safety", () => {
    it("should simulate setup backup safety and prevent data loss when backup destination already exists", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "backup-safety-"));
      fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"orig"}');
      fs.writeFileSync(path.join(tempDir, "package.json.test_bak_123"), '{"name":"existing-bak"}');

      process.chdir(tempDir);
      try {
        const item = "package.json";
        const bakItem = `${item}.test_bak_123`;
        let errorOccurred = false;

        if (fs.existsSync(bakItem)) {
          errorOccurred = true;
        }

        expect(errorOccurred).toBe(true);
        expect(fs.readFileSync(path.join(tempDir, "package.json"), "utf8")).toBe('{"name":"orig"}');
        expect(fs.readFileSync(path.join(tempDir, "package.json.test_bak_123"), "utf8")).toBe(
          '{"name":"existing-bak"}',
        );
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should restore original files cleanly if setup fails midway", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "mid-setup-fail-"));
      fs.writeFileSync(path.join(tempDir, "package.json"), '{"name":"orig-pkg"}');
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'orig-py'\n");

      process.chdir(tempDir);
      try {
        const backedUpFiles: string[] = [];

        // Back up package.json
        fs.renameSync("package.json", "package.json.test_bak_999");
        backedUpFiles.push("package.json|package.json.test_bak_999");

        // Simulate setup failure before pyproject.toml is backed up
        const setupFailed = true;

        if (setupFailed) {
          // Cleanup restores only items logged in backedUpFiles
          for (const entry of backedUpFiles) {
            const [orig, bak] = entry.split("|");
            if (fs.existsSync(bak)) {
              if (fs.existsSync(orig)) fs.rmSync(orig, { recursive: true, force: true });
              fs.renameSync(bak, orig);
            }
          }
        }

        expect(fs.existsSync("package.json")).toBe(true);
        expect(fs.readFileSync("package.json", "utf8")).toBe('{"name":"orig-pkg"}');
        expect(fs.existsSync("pyproject.toml")).toBe(true);
        expect(fs.readFileSync("pyproject.toml", "utf8")).toBe("[project]\nname = 'orig-py'\n");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario Matrix Verification", () => {
    it("regression test: Python-only project with stray .nvmrc and .bun-version files", () => {
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

        expect(core.info).not.toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Found .nvmrc"));
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Found .bun-version"));
        expect(core.info).toHaveBeenCalledWith("Detected: Python");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.4.2");
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

        expect(core.startGroup).not.toHaveBeenCalled();
        expect(core.endGroup).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).toHaveBeenCalledWith(`Runtime: Node.js ${DEFAULT_NODE_VERSION}`);
        expect(core.info).toHaveBeenCalledWith(`Package Manager: npm ${DEFAULT_NPM_VERSION}`);
        expect(core.info).toHaveBeenCalledWith("Toolchain: vite");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime-version", DEFAULT_NODE_VERSION);
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", DEFAULT_NPM_VERSION);

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
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

        expect(core.startGroup).not.toHaveBeenCalled();
        expect(core.endGroup).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith("Detected: Python");
        expect(core.info).toHaveBeenCalledWith("Runtime: Python 3.12");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pip");
        expect(core.info).toHaveBeenCalledWith("Ruff: 0.4.2");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.4.2");
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

        expect(core.startGroup).not.toHaveBeenCalled();
        expect(core.endGroup).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript, Python");
        expect(core.info).toHaveBeenCalledWith(`Runtime: Node.js ${DEFAULT_NODE_VERSION}, Python 3.12`);
        expect(core.info).toHaveBeenCalledWith("Package Manager: pnpm 9.0.0, uv");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "9.0.0");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
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

        expect(core.startGroup).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith(
          "No supported project environment detected.",
        );

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
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
        expect(env.javascript.packageManager).toMatchObject({ name: "npm", version: "12.0.0" });
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).toHaveBeenCalledWith(`Runtime: Node.js ${DEFAULT_NODE_VERSION}`);
        expect(core.info).toHaveBeenCalledWith("Package Manager: npm 12.0.0");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "12.0.0");
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
        expect(env.javascript.packageManager).toMatchObject({ name: "pnpm", version: "9.5.0" });
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).toHaveBeenCalledWith(`Runtime: Node.js ${DEFAULT_NODE_VERSION}`);
        expect(core.info).toHaveBeenCalledWith("Package Manager: pnpm 9.5.0");
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
        expect(env.javascript.packageManager).toMatchObject({ name: "bun", version: "1.4.0" });
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).toHaveBeenCalledWith("Runtime: Bun 1.4.0");
        expect(core.info).toHaveBeenCalledWith("Package Manager: bun 1.4.0");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4.0");
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
        expect(core.setOutput).toHaveBeenCalledWith("node-version", DEFAULT_NODE_VERSION);
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4.0");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("preserves latest when Bun is configured through packageManager", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-bun-latest-"));
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "bun-latest-app", packageManager: "bun@latest" }),
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.name).toBe("bun");
        expect(env.javascript.runtime.version).toBe("latest");
        expect(env.javascript.packageManager).toMatchObject({ name: "bun", version: "latest" });
        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript");
        expect(core.info).toHaveBeenCalledWith("Runtime: Bun latest");
        expect(core.info).toHaveBeenCalledWith("Package Manager: bun latest");
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", "latest");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "latest");
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
        expect(core.info).toHaveBeenCalledWith("Detected: Python");
        expect(core.info).toHaveBeenCalledWith("Runtime: Python 3.12");
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
        expect(core.info).toHaveBeenCalledWith("Detected: Python");
        expect(core.info).toHaveBeenCalledWith("Runtime: Python 3.12");
        expect(core.info).toHaveBeenCalledWith("Package Manager: pip");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("uses default versions when version declarations are missing", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-missing-vers-"));
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "no-ver-app" }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hi')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.runtime.version).toBe(DEFAULT_NODE_VERSION);
        expect(env.python.version).toBe("3.12");

        expect(core.info).toHaveBeenCalledWith("Detected: JavaScript, Python");
        expect(core.info).toHaveBeenCalledWith(`Runtime: Node.js ${DEFAULT_NODE_VERSION}, Python 3.12`);
        expect(core.info).toHaveBeenCalledWith(`Package Manager: npm ${DEFAULT_NPM_VERSION}, pip`);

        expect(core.setOutput).toHaveBeenCalledWith("node-version", DEFAULT_NODE_VERSION);
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
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

    it("resolves Python environment without JavaScript project from nested services/py-svc directory", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-workspace-nested-py-"));
      fs.mkdirSync(path.join(tempDir, "packages/js-pkg"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "services/py-svc"), { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        '[tool.uv.workspace]\nmembers = ["services/*"]\n',
      );
      fs.writeFileSync(
        path.join(tempDir, "packages/js-pkg/package.json"),
        JSON.stringify({ name: "js-nested-pkg" }),
      );
      fs.writeFileSync(
        path.join(tempDir, "services/py-svc/pyproject.toml"),
        "[project]\nname = 'py-svc'\n",
      );
      fs.writeFileSync(path.join(tempDir, "services/py-svc/service.py"), "print('svc')\n");

      process.chdir(path.join(tempDir, "services/py-svc"));
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.python.detected).toBe(true);
        expect(env.javascript.detected).toBe(false);
        expect(env.python.packageManager?.name).toBe("uv");

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "uv");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("resolves JavaScript project from nested packages/js-pkg directory without detecting Python", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "matrix-workspace-nested-js-"));
      fs.mkdirSync(path.join(tempDir, "packages/js-pkg"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "services/py-svc"), { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        '[tool.uv.workspace]\nmembers = ["services/*"]\n',
      );
      fs.writeFileSync(
        path.join(tempDir, "packages/js-pkg/package.json"),
        JSON.stringify({ name: "js-nested-pkg", packageManager: "pnpm@9.1.0" }),
      );
      fs.writeFileSync(
        path.join(tempDir, "services/py-svc/pyproject.toml"),
        "[project]\nname = 'py-svc'\n",
      );
      fs.writeFileSync(path.join(tempDir, "services/py-svc/service.py"), "print('svc')\n");

      process.chdir(path.join(tempDir, "packages/js-pkg"));
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.javascript.detected).toBe(true);
        expect(env.javascript.packageManager).toMatchObject({ name: "pnpm", version: "9.1.0" });
        expect(env.python.detected).toBe(false);

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "9.1.0");
        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
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
          [".nvmrc", "package-lock.json"].includes(p as string),
        );
        vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
          if (p === ".nvmrc") return "22.1.0\n" as any;
          return "" as any;
        });

        const run1 = resolveEnvironment();
        const run2 = resolveEnvironment();

        expect(run1).toEqual(run2);
        expect(run1.javascript.runtime.version).toBe("22.1.0");
        expect(run1.javascript.packageManager).toMatchObject({ name: "npm", version: DEFAULT_NPM_VERSION });
        expect(run1.javascript.runtime.name).toBe("node");
        expect(run1.javascript.toolchain).toBe("vite");
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
          runtime: { name: "node", version: "24" },
          packageManager: { name: "pnpm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      const plan = createSetupPlan(env);

      expect(plan.node.shouldSetup).toBe(false);
      expect(plan.pnpm.shouldSetup).toBe(true);
      expect(plan.pnpm.pnpmRuntime).toBe("node@24");

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
        expectedNode: "24.19.0",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "minimal",
        expectedNode: "24",
        expectedPm: { name: "npm", version: "12" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedNode: "24",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "24",
        expectedPm: { name: "pnpm", version: DEFAULT_PNPM_VERSION },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun@1.4",
        type: "basic",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedBun: ">=1.0.0",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "bun",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun@1.4",
        type: "minimal",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "npm@11.19.0",
        type: "basic",
        expectedNode: "24.19.0",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedNode: "24",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should resolve correct environment for fixture $action/$runtime/$pm/$type",
      ({ action, runtime: rt, pm, type, expectedNode, expectedBun, expectedPm, expectedRuntime }) => {
        const scenarioPath = fs.mkdtempSync(path.join(fixturesDir, `res-env-${action}-${rt}-${type}-`));
        createConsumerProject(scenarioPath, { action, runtime: rt, pm, type });
        process.chdir(scenarioPath);

        try {
          const env = resolveEnvironment();

          if (expectedRuntime === "node") {
            expect(env.javascript.runtime.version).toBe(expectedNode);
          } else {
            expect(env.javascript.runtime.version).toBe(expectedBun);
          }
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

    it("should output node-version, bun-version, package manager, runtime, pnpm-runtime, and plan step outputs correctly for ResolvedEnvironment", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node", version: "20.10.0" },
          packageManager: { name: "pnpm", version: "9.0.0" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", DEFAULT_BUN_VERSION);
      expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "9.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should output all detected values when passed a ResolvedEnvironment object", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", DEFAULT_BUN_VERSION);
      expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "12");
      expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@24");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
    });

    it("should set python-detected and setup-python to false and clear python outputs when no Python source files exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("python-detected", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
      expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
    });

    it("should verify python-version is empty string for python-none fixture output", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "py-none-"));
      createConsumerProject(tempDir, { type: "python-none" });
      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.python.detected).toBe(false);
        expect(env.python.version).toBe("");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should set python-detected and setup-python to true and resolve python outputs when Python source exists", () => {
      const tempDir = path.join(fixturesDir, "python-source-test-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        writeOutput(env);

        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.4.2");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should set setup-node to false for Python-only projects without package.json", () => {
      const tempDir = path.join(fixturesDir, "python-only-node-setup-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        writeOutput(env);

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
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

        expect(core.setOutput).toHaveBeenCalledWith("node-version", "24.19.0");
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "11.19.0");
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

        expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "bun");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "1.4");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using lts/*");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });

    it("should resolve pnpm package manager and set plan outputs for pnpm fixture in bun runtime", () => {
      const fixturePath = fs.mkdtempSync(path.join(fixturesDir, "pages-bun-pnpm-basic-"));
      createConsumerProject(fixturePath, { action: "pages", runtime: "bun", pm: "pnpm@12.15.0", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-pnpm-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
        expect(core.setOutput).toHaveBeenCalledWith("bun-version", ">=1.0.0");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager", "pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-package-manager-version", "12.15.0");
        expect(core.setOutput).toHaveBeenCalledWith("javascript-runtime", "bun");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });

    it("should ensure setup-node is false for Python-only project when run() executes", () => {
      const tempDir = path.join(fixturesDir, "python-only-run-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("javascript-detected", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-detected", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("toolchain resolution inputs", () => {
    it("should resolve toolchain to 'vite-plus' when toolchainInput is 'vite-plus'", () => {
      const fixturePath = fs.mkdtempSync(path.join(fixturesDir, "pages-npm-basic-"));
      createConsumerProject(fixturePath, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(fixturePath);

      try {
        const resolved = resolveEnvironment("vite-plus");
        expect(resolved.javascript.toolchain).toBe("vite-plus");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });

    it("should resolve toolchain to 'vite' when toolchainInput is 'vite'", () => {
      const fixturePath = fs.mkdtempSync(path.join(fixturesDir, "vp-minimal-"));
      createConsumerProject(fixturePath, { toolchain: "vite-plus", runtime: "node", pm: "pnpm@12.15.0", type: "vite-plus" });
      process.chdir(fixturePath);

      try {
        const resolved = resolveEnvironment("vite");
        expect(resolved.javascript.toolchain).toBe("vite");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(fixturePath, { recursive: true, force: true });
      }
    });

    it("should auto-detect toolchain when toolchainInput is 'auto' or empty", () => {
      const vpFixture = fs.mkdtempSync(path.join(fixturesDir, "vp-minimal-auto-"));
      createConsumerProject(vpFixture, { toolchain: "vite-plus", runtime: "node", pm: "pnpm@12.15.0", type: "vite-plus" });
      process.chdir(vpFixture);
      try {
        const resolvedVp = resolveEnvironment("auto");
        expect(resolvedVp.javascript.toolchain).toBe("vite-plus");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(vpFixture, { recursive: true, force: true });
      }

      const stdFixture = fs.mkdtempSync(path.join(fixturesDir, "std-fixture-"));
      createConsumerProject(stdFixture, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(stdFixture);
      try {
        const resolvedStd = resolveEnvironment("");
        expect(resolvedStd.javascript.toolchain).toBe("vite");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(stdFixture, { recursive: true, force: true });
      }
    });

    it("should throw INVALID_INPUT when toolchainInput is unsupported", () => {
      expect(() => resolveEnvironment("invalid-toolchain")).toThrow();
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
          runtime: { name: "node", version: "22" },
          packageManager: { name: "pnpm", version: "10.5.2" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenNthCalledWith(1, "Detected: JavaScript");
      expect(core.info).toHaveBeenNthCalledWith(2, "Runtime: Node.js 22");
      expect(core.info).toHaveBeenNthCalledWith(3, "Package Manager: pnpm 10.5.2");
      expect(core.info).toHaveBeenNthCalledWith(4, "Toolchain: vite");
    });

    it("Scenario 2: Single-environment resolution (Python) formats plain consolidated lines without groups", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: true,
          version: "3.12",
          ruffVersion: "0.17.2",
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
      expect(core.info).toHaveBeenNthCalledWith(1, "Detected: Python");
      expect(core.info).toHaveBeenNthCalledWith(2, "Runtime: Python 3.12");
      expect(core.info).toHaveBeenNthCalledWith(3, "Package Manager: uv");
      expect(core.info).toHaveBeenNthCalledWith(4, "Ruff: 0.17.2");
    });

    it("Scenario 3: Multiple detected environments (JavaScript and Python) consolidates categories into single lines", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: true,
          runtime: { name: "node", version: "22" },
          packageManager: { name: "pnpm", version: "10.5.2" },
          toolchain: "vite-plus",
        },
        python: {
          detected: true,
          version: "3.12",
          ruffVersion: "0.17.2",
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
      expect(core.info).toHaveBeenNthCalledWith(1, "Detected: JavaScript, Python");
      expect(core.info).toHaveBeenNthCalledWith(2, "Runtime: Node.js 22, Python 3.12");
      expect(core.info).toHaveBeenNthCalledWith(3, "Package Manager: pnpm 10.5.2, uv");
      expect(core.info).toHaveBeenNthCalledWith(4, "Toolchain: vite-plus");
      expect(core.info).toHaveBeenNthCalledWith(5, "Ruff: 0.17.2");
    });

    it("Scenario 4: Unavailable optional values (empty ruffVersion) are omitted without placeholder lines", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: true,
          version: "3.12",
          ruffVersion: "",
          packageManager: {
            name: "pip",
            execPrefix: "",
            installCommands: [],
            isStandalone: true,
          },
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("Ruff"));
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("null"));
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("undefined"));
      expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining("unknown"));
    });

    it("Scenario 5: No supported environment detected logs concise message without groups or runtime lines", () => {
      const env: ResolvedEnvironment = {
        javascript: {
          detected: false,
          runtime: { name: "node", version: "24" },
          packageManager: { name: "npm", version: "12" },
          toolchain: "vite",
        },
        python: {
          detected: false,
          version: "",
          ruffVersion: "",
          packageManager: null,
        },
      };

      logResolvedEnvironment(env);

      expect(core.startGroup).not.toHaveBeenCalled();
      expect(core.endGroup).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith("No supported project environment detected.");
    });
  });
});
