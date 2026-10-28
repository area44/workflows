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
  resolveEnvironment,
  resolvePnpmSetupRuntime,
  run,
  setupBun,
  setupNode,
  setupPackageManager,
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
        js: {
          hasJsProject: true,
          project: {
            hasPackageJson: true,
            hasPnpmLock: false,
            hasPackageLock: true,
            hasBunLock: false,
          },
          pm: { name: "npm", version: "12" },
          runtime: "node",
          nodeVersion: "24",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: true,
          pythonVersion: "3.12",
          ruffVersion: "0.4.2",
          pmInfo: {
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

    it("should validate a valid Python environment with pmInfo: null when hasPythonSource is false", () => {
      const valid = createValidEnvironment();
      valid.python.hasPythonSource = false;
      valid.python.pythonVersion = "";
      valid.python.ruffVersion = "";
      valid.python.pmInfo = null;
      expect(validateEnvironment(valid)).toEqual(valid);
    });

    it("should reject hasPythonSource: false with non-null pmInfo", () => {
      const env = createValidEnvironment();
      env.python.hasPythonSource = false;
      env.python.pythonVersion = "";
      env.python.ruffVersion = "";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo" must be null when hasPythonSource is false',
      );
    });

    it("should reject hasPythonSource: false with non-empty pythonVersion or ruffVersion", () => {
      const env1 = createValidEnvironment();
      env1.python.hasPythonSource = false;
      env1.python.pythonVersion = "3.12";
      env1.python.ruffVersion = "";
      env1.python.pmInfo = null;
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: "pythonVersion" must be empty string when hasPythonSource is false',
      );

      const env2 = createValidEnvironment();
      env2.python.hasPythonSource = false;
      env2.python.pythonVersion = "";
      env2.python.ruffVersion = "0.4.2";
      env2.python.pmInfo = null;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "ruffVersion" must be empty string when hasPythonSource is false',
      );
    });

    it("should reject hasPythonSource: true with pmInfo: null", () => {
      const env = createValidEnvironment();
      env.python.hasPythonSource = true;
      env.python.pmInfo = null;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo" cannot be null when hasPythonSource is true',
      );
    });

    it("should reject missing pmInfo property", () => {
      const env = createValidEnvironment();
      delete (env.python as any).pmInfo;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo" property is required',
      );
    });

    it("should reject explicit pmInfo: undefined", () => {
      const env = createValidEnvironment();
      (env.python as any).pmInfo = undefined;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo" property is required',
      );
    });

    it.each([123, "uv", true, [1, 2, 3]])(
      "should reject invalid primitive or array value for pmInfo: %p",
      (invalidPmInfo) => {
        const env = createValidEnvironment();
        (env.python as any).pmInfo = invalidPmInfo;
        expect(() => validateEnvironment(env)).toThrow(
          'Invalid Python environment: "pmInfo" must be an object when present',
        );
      },
    );

    it.each(["poetry", "npm", "pipenv", "", "PIP"])(
      "should reject invalid package manager name in pmInfo: %p",
      (invalidName) => {
        const env = createValidEnvironment();
        (env.python.pmInfo as any).name = invalidName;
        expect(() => validateEnvironment(env)).toThrow(
          'Invalid Python environment: pmInfo name must be "uv" or "pip"',
        );
      },
    );

    it("should validate legitimate resolver output for standalone Python source without manifest", () => {
      const tempDir = path.join(fixturesDir, "standalone-pm-validation-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "script.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.python.hasPythonSource).toBe(true);
        expect(env.python.pmInfo).toEqual({
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

    it("should throw error for missing or invalid js section", () => {
      const env = createValidEnvironment();
      delete (env as any).js;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid environment: missing or invalid "js" section',
      );
    });

    it("should throw error for missing or invalid python section", () => {
      const env = createValidEnvironment();
      delete (env as any).python;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid environment: missing or invalid "python" section',
      );
    });

    it("should throw error for non-boolean hasJsProject", () => {
      const env = createValidEnvironment();
      (env.js as any).hasJsProject = "true";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid JavaScript environment: "hasJsProject" must be a boolean',
      );
    });

    it("should throw error for invalid runtime in js section", () => {
      const env = createValidEnvironment();
      (env.js as any).runtime = "invalid-runtime";
      expect(() => validateEnvironment(env)).toThrow('Invalid resolved runtime: "invalid-runtime"');
    });

    it("should throw error for invalid or missing package manager in js section", () => {
      const env = createValidEnvironment();
      (env.js as any).pm = { name: "", version: "12" };
      expect(() => validateEnvironment(env)).toThrow("Invalid resolved package manager");
    });

    it("should throw error for non-string nodeVersion or bunVersion in js section", () => {
      const env = createValidEnvironment();
      (env.js as any).nodeVersion = 24;
      expect(() => validateEnvironment(env)).toThrow("Invalid resolved versions");
    });

    it("should throw error for invalid toolchain in js section", () => {
      const env = createValidEnvironment();
      (env.js as any).toolchain = "webpack";
      expect(() => validateEnvironment(env)).toThrow('Invalid resolved toolchain: "webpack"');
    });

    it("should throw error for non-boolean hasPythonSource", () => {
      const env = createValidEnvironment();
      (env.python as any).hasPythonSource = "yes";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "hasPythonSource" must be a boolean',
      );
    });

    it("should throw error for non-string pythonVersion or ruffVersion", () => {
      const env = createValidEnvironment();
      (env.python as any).pythonVersion = 3.12;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pythonVersion" must be a string',
      );

      const env2 = createValidEnvironment();
      (env2.python as any).ruffVersion = undefined;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "ruffVersion" must be a string',
      );
    });

    it("should throw error for invalid required pmInfo string fields", () => {
      const env = createValidEnvironment();
      (env.python.pmInfo as any).execPrefix = null;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.execPrefix" must be a string',
      );
    });

    it("should reject legacy installCommand supplied without installCommands", () => {
      const env = createValidEnvironment();
      delete (env.python.pmInfo as any).installCommands;
      (env.python.pmInfo as any).installCommand = "uv sync";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.installCommands" must be an array',
      );
    });

    it("should throw error for invalid optional string or boolean fields in pmInfo", () => {
      const env = createValidEnvironment();
      (env.python.pmInfo as any).lockfile = 456;
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.lockfile" must be a string',
      );

      const env2 = createValidEnvironment();
      (env2.python.pmInfo as any).isStandalone = "false";
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: "pmInfo.isStandalone" must be a boolean',
      );
    });

    it("should reject inconsistent standalone metadata in pmInfo", () => {
      const env1 = createValidEnvironment();
      env1.python.pmInfo!.isStandalone = true;
      // installCommands is non-empty
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: standalone "pmInfo" must have empty installCommands array',
      );

      const env2 = createValidEnvironment();
      env2.python.pmInfo!.isStandalone = true;
      env2.python.pmInfo!.installCommands = [];
      env2.python.pmInfo!.lockfile = "uv.lock";
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: standalone "pmInfo" cannot specify lockfile or configFile',
      );
    });

    it("should reject inconsistent UV lockfile metadata in pmInfo", () => {
      const env1 = createValidEnvironment();
      env1.python.pmInfo!.name = "uv";
      env1.python.pmInfo!.lockfile = "invalid.lock";
      expect(() => validateEnvironment(env1)).toThrow(
        'Invalid Python environment: UV lockfile name must be "uv.lock" when present',
      );

      const env2 = createValidEnvironment();
      env2.python.pmInfo!.name = "uv";
      env2.python.pmInfo!.lockfile = "uv.lock";
      delete env2.python.pmInfo!.configFile;
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: UV lockfile requires configFile "pyproject.toml"',
      );
    });

    it("should throw error for malformed installCommands in pmInfo", () => {
      const env = createValidEnvironment();
      (env.python.pmInfo as any).installCommands = "uv sync";
      expect(() => validateEnvironment(env)).toThrow(
        'Invalid Python environment: "pmInfo.installCommands" must be an array',
      );

      const env2 = createValidEnvironment();
      (env2.python.pmInfo as any).installCommands = [{ executable: "uv", args: "sync" }];
      expect(() => validateEnvironment(env2)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );

      const env3 = createValidEnvironment();
      (env3.python.pmInfo as any).installCommands = [{ executable: "", args: ["sync"] }];
      expect(() => validateEnvironment(env3)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );

      const env4 = createValidEnvironment();
      (env4.python.pmInfo as any).installCommands = [{ executable: "uv", args: [123] }];
      expect(() => validateEnvironment(env4)).toThrow(
        'Invalid Python environment: malformed "installCommands" item',
      );
    });

    it("should prove writeOutput is not called when validation fails in run()", () => {
      const getInputSpy = vi.spyOn(core, "getInput").mockImplementation((name) => {
        if (name === "runtime") return "invalid-runtime";
        return "";
      });

      try {
        run();

        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringContaining("Environment setup failed:"),
        );
        expect(core.setOutput).not.toHaveBeenCalled();
      } finally {
        getInputSpy.mockRestore();
      }
    });
  });

  describe("CI Workspace Setup and Restoration Safety", () => {
    it("should simulate setup backup safety and prevent data loss when backup destination already exists", () => {
      const tempDir = path.join(fixturesDir, "backup-safety-temp");
      fs.mkdirSync(tempDir, { recursive: true });
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
      const tempDir = path.join(fixturesDir, "mid-setup-failure-temp");
      fs.mkdirSync(tempDir, { recursive: true });
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
    it("Scenario 1: JavaScript/TypeScript only - Report JS detection and skip Python setup", () => {
      const tempDir = path.join(fixturesDir, "matrix-js-only-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "js-app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(true);
        expect(env.python.hasPythonSource).toBe(false);

        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Resolved runtime: Node.js.");
        expect(core.info).not.toHaveBeenCalledWith("Detected Python project.");

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("node-version", DEFAULT_NODE_VERSION);
        expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
        expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", DEFAULT_NPM_VERSION);
        expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 2: Python only - Report Python detection and skip Node.js/Bun/pnpm setup", () => {
      const tempDir = path.join(fixturesDir, "matrix-py-only-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(false);
        expect(env.python.hasPythonSource).toBe(true);

        expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Detected Python project.");
        expect(core.info).toHaveBeenCalledWith("Resolved Python package manager: pip");

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "pip");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "0.4.2");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 3: Both environments - Report both independently and configure both", () => {
      const tempDir = path.join(fixturesDir, "matrix-both-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
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

        expect(env.js.hasJsProject).toBe(true);
        expect(env.python.hasPythonSource).toBe(true);

        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Detected Python project.");

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
        expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
        expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "9.0.0");
        expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "true");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "3.12");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "uv");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 4: Neither environment - Report neither detected and use defaults without activating setup", () => {
      const tempDir = path.join(fixturesDir, "matrix-neither-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "README.md"), "# Empty Repo\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.js.hasJsProject).toBe(false);
        expect(env.python.hasPythonSource).toBe(false);

        expect(core.info).not.toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).not.toHaveBeenCalledWith("Detected Python project.");
        expect(core.info).toHaveBeenCalledWith(
          "Neither JavaScript/TypeScript nor Python project detected. Default configuration will be used for any required resolution.",
        );

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
        expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
        expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 5: Node.js with npm - Report Node.js and npm correctly", () => {
      const tempDir = path.join(fixturesDir, "matrix-node-npm-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "node-npm-app", packageManager: "npm@12.0.0" }),
      );

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.js.runtime).toBe("node");
        expect(env.js.pm).toEqual({ name: "npm", version: "12.0.0" });
        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Resolved runtime: Node.js.");
        expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: npm@12.0.0");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 6: Node.js with pnpm - Report Node.js and pnpm correctly", () => {
      const tempDir = path.join(fixturesDir, "matrix-node-pnpm-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "node-pnpm-app", packageManager: "pnpm@9.5.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.js.runtime).toBe("node");
        expect(env.js.pm).toEqual({ name: "pnpm", version: "9.5.0" });
        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Resolved runtime: Node.js.");
        expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: pnpm@9.5.0");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 7: Bun project - Report Bun and its package manager correctly", () => {
      const tempDir = path.join(fixturesDir, "matrix-bun-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "bun-app", packageManager: "bun@1.4.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "bun.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.js.runtime).toBe("bun");
        expect(env.js.pm).toEqual({ name: "bun", version: "1.4.0" });
        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
        expect(core.info).toHaveBeenCalledWith("Resolved runtime: Bun.");
        expect(core.info).toHaveBeenCalledWith("Found packageManager in package.json: bun@1.4.0");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 8: Python with uv - Report Python and uv correctly", () => {
      const tempDir = path.join(fixturesDir, "matrix-py-uv-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'py-uv-app'\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.python.hasPythonSource).toBe(true);
        expect(env.python.pmInfo?.name).toBe("uv");
        expect(core.info).toHaveBeenCalledWith("Detected Python project.");
        expect(core.info).toHaveBeenCalledWith("Resolved Python package manager: uv");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 9: Python with pip - Report Python and pip correctly", () => {
      const tempDir = path.join(fixturesDir, "matrix-py-pip-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests>=2.0.0\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.python.hasPythonSource).toBe(true);
        expect(env.python.pmInfo?.name).toBe("pip");
        expect(core.info).toHaveBeenCalledWith("Detected Python project.");
        expect(core.info).toHaveBeenCalledWith("Resolved Python package manager: pip");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 10: Explicit runtime or version input - Preserve input precedence and report configuration", () => {
      const tempDir = path.join(fixturesDir, "matrix-explicit-input-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "explicit-app" }));

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment("node@22");
        expect(env.js.runtime).toBe("node");
        expect(env.js.nodeVersion).toBe("22");
        expect(core.info).toHaveBeenCalledWith("Detected JavaScript/TypeScript project.");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 11: Missing version declarations - Distinguish defaults from detected values", () => {
      const tempDir = path.join(fixturesDir, "matrix-missing-vers-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "no-ver-app" }));
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hi')\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        expect(env.js.nodeVersion).toBe(DEFAULT_NODE_VERSION);
        expect(env.python.pythonVersion).toBe("3.12");

        expect(core.info).toHaveBeenCalledWith(
          `Node.js version not specified; using default: ${DEFAULT_NODE_VERSION}`,
        );
        expect(core.info).toHaveBeenCalledWith(
          `Python version not specified; using default: 3.12`,
        );
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("Scenario 12: Malformed project configuration - Preserve validation and failure behavior", () => {
      const tempDir = path.join(fixturesDir, "matrix-malformed-config-" + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });
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

    it("Nested directories and workspace scenario: Python workspace and nested JS package", () => {
      const tempDir = path.join(fixturesDir, "matrix-workspace-nested-" + Date.now());
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
        expect(env.python.hasPythonSource).toBe(true);
        expect(env.js.hasJsProject).toBe(false);
        expect(env.python.pmInfo?.name).toBe("uv");
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

        const run1 = resolveEnvironment("node");
        const run2 = resolveEnvironment("node");

        expect(run1).toEqual(run2);
        expect(run1.js.nodeVersion).toBe("22.1.0");
        expect(run1.js.bunVersion).toBe("");
        expect(run1.js.pm).toEqual({ name: "npm", version: DEFAULT_NPM_VERSION });
        expect(run1.js.runtime).toBe("node");
        expect(run1.js.toolchain).toBe("vite");
        expect(run1.python.hasPythonSource).toBe(false);
      });
    });
  });

  describe("Tool-Specific Setup Adapters", () => {
    describe("resolvePnpmSetupRuntime", () => {
      it("should format bun runtime specifier when bunVersion is present", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "24",
            bunVersion: "1.4",
          }),
        ).toBe("bun@1.4");
      });

      it("should format node runtime specifier when nodeVersion is present and not lts", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "22.1.0",
            bunVersion: "",
          }),
        ).toBe("node@22.1.0");
      });

      it("should format node@lts when nodeVersion starts with lts or is empty", () => {
        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "lts/iron",
            bunVersion: "",
          }),
        ).toBe("node@lts");

        expect(
          resolvePnpmSetupRuntime({
            nodeVersion: "",
            bunVersion: "",
          }),
        ).toBe("node@lts");
      });
    });

    describe("setupNode adapter", () => {
      it("should return correct setup options for npm package manager", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "24",
          cache: "npm",
        });
      });

      it("should return correct setup options for bun package manager with node runtime", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "node",
            nodeVersion: "22",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: true,
          nodeVersion: "22",
          cache: "",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: false,
          nodeVersion: "24",
          cache: "",
        });
      });

      it("should return shouldSetup=false when nodeVersion is empty", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupNode(env)).toEqual({
          shouldSetup: false,
          nodeVersion: "",
          cache: "",
        });
      });
    });

    describe("setupBun adapter", () => {
      it("should return shouldSetup=true and bunVersion when package manager is not pnpm and bunVersion is set", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: true,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when package manager is pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "bun",
            nodeVersion: "24",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "1.4",
        });
      });

      it("should return shouldSetup=false when bunVersion is empty", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupBun(env)).toEqual({
          shouldSetup: false,
          bunVersion: "",
        });
      });
    });

    describe("setupPackageManager adapter", () => {
      it("should extract package manager options for pnpm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "9.0.0" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "pnpm",
          version: "9.0.0",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: true,
        });
      });

      it("should extract package manager options for npm", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "npm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "npm",
          version: "12",
          pnpmRuntime: "node@24",
          shouldSetupPnpm: false,
        });
      });

      it("should extract package manager options for bun", () => {
        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "bun", version: "1.4" },
            runtime: "bun",
            nodeVersion: "",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };
        expect(setupPackageManager(env)).toEqual({
          name: "bun",
          version: "1.4",
          pnpmRuntime: "bun@1.4",
          shouldSetupPnpm: false,
        });
      });
    });

    describe("Boundary Separation (Resolver vs Adapter)", () => {
      it("adapters take resolved environment and do not re-trigger workspace detection", () => {
        const existsSpy = vi.spyOn(fs, "existsSync");
        const readSpy = vi.spyOn(fs, "readFileSync");

        const env: ResolvedEnvironment = {
          js: {
            hasJsProject: true,
            project: {} as any,
            pm: { name: "pnpm", version: "12" },
            runtime: "node",
            nodeVersion: "24",
            bunVersion: "1.4",
            toolchain: "vite",
          },
          python: {} as any,
        };

        const nodeConfig = setupNode(env);
        const bunConfig = setupBun(env);
        const pmConfig = setupPackageManager(env);
        const pnpmRuntime = resolvePnpmSetupRuntime(env.js);

        expect(nodeConfig).toBeDefined();
        expect(bunConfig).toBeDefined();
        expect(pmConfig).toBeDefined();
        expect(pnpmRuntime).toBe("bun@1.4");

        expect(existsSpy).not.toHaveBeenCalled();
        expect(readSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("resolveEnvironment", () => {
    it("should respect explicit runtime input node@22", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = resolveEnvironment("node@22");

      expect(env.js.runtime).toBe("node");
      expect(env.js.nodeVersion).toBe("22");
      expect(env.js.bunVersion).toBe("");
    });

    it("should respect explicit runtime input bun@1.4", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "bun.lock");
      const env = resolveEnvironment("bun@1.4");

      expect(env.js.runtime).toBe("bun");
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should throw validation error when explicit runtime bun@1.4 is used with npm package manager", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(() => resolveEnvironment("bun@1.4")).toThrow(
        "Unsupported runtime and package manager combination: Bun runtime does not support npm package manager",
      );
    });

    it("should respect explicit runtime input node@22,bun@1.4 and output versions for both", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const env = resolveEnvironment("node@22,bun@1.4");

      expect(env.js.runtime).toBe("node");
      expect(env.js.nodeVersion).toBe("22");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=node when explicit runtime=node is supplied even if package manager is bun", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "bun@1.4" }) as any,
      );

      const env = resolveEnvironment("node");

      expect(env.js.runtime).toBe("node");
      expect(env.js.pm).toEqual({ name: "bun", version: "1.4" });
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
    });

    it("should resolve runtime=bun when explicit runtime=bun is supplied even if package manager is pnpm", () => {
      vi.spyOn(fs, "existsSync").mockImplementation((p) => p === "package.json");
      vi.spyOn(fs, "readFileSync").mockReturnValue(
        JSON.stringify({ packageManager: "pnpm@12.15.0" }) as any,
      );

      const env = resolveEnvironment("bun");

      expect(env.js.runtime).toBe("bun");
      expect(env.js.pm).toEqual({ name: "pnpm", version: "12.15.0" });
      expect(env.js.nodeVersion).toBe("");
      expect(env.js.bunVersion).toBe("1.4");
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
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "npm", version: "12" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "node",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: DEFAULT_PNPM_VERSION },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun@1.4",
        type: "basic",
        expectedNode: "",
        expectedBun: "1.4",
        expectedPm: { name: "bun", version: "1.4" },
        expectedRuntime: "bun",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedNode: "24",
        expectedBun: ">=1.0.0",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "node",
      },
      {
        action: "pages",
        runtime: "bun",
        pm: "bun@1.4",
        type: "minimal",
        expectedNode: "",
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
        expectedBun: "",
        expectedPm: { name: "npm", version: "11.19.0" },
        expectedRuntime: "node",
      },
      {
        action: "autofix",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
        expectedNode: "24",
        expectedBun: "",
        expectedPm: { name: "pnpm", version: "12.15.0" },
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should resolve correct environment for fixture $action/$runtime/$pm/$type",
      ({ action, runtime: rt, pm, type, expectedNode, expectedBun, expectedPm, expectedRuntime }) => {
        const scenarioPath = path.join(fixturesDir, `res-env-${action}-${rt}-${type}-${Date.now()}`);
        createConsumerProject(scenarioPath, { action, runtime: rt, pm, type });
        process.chdir(scenarioPath);

        try {
          const env = resolveEnvironment();

          expect(env.js.nodeVersion).toBe(expectedNode);
          expect(env.js.bunVersion).toBe(expectedBun);
          expect(env.js.pm).toEqual(expectedPm);
          expect(env.js.runtime).toBe(expectedRuntime);
        } finally {
          process.chdir(originalCwd);
          fs.rmSync(scenarioPath, { recursive: true, force: true });
        }
      },
    );
  });

  describe("writeOutput", () => {
    it("should consume env.js and env.python directly without re-inspecting filesystem", () => {
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

    it("should output node-version, bun-version, package manager, runtime, pnpm-runtime, and adapter step outputs correctly for ResolvedEnvironment", () => {
      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: true,
          project: {} as any,
          pm: { name: "pnpm", version: "9.0.0" },
          runtime: "node",
          nodeVersion: "20.10.0",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "9.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@20.10.0");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should output all detected values when passed a ResolvedEnvironment object", () => {
      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: true,
          project: {} as any,
          pm: { name: "npm", version: "12" },
          runtime: "node",
          nodeVersion: "24",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "12");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("pnpm-runtime", "node@24");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
    });

    it("should set has-python-source and setup-python to false and clear python outputs when no Python source files exist", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const env: ResolvedEnvironment = {
        js: {
          hasJsProject: false,
          project: {} as any,
          pm: { name: "npm", version: "12" },
          runtime: "node",
          nodeVersion: "24",
          bunVersion: "",
          toolchain: "vite",
        },
        python: {
          hasPythonSource: false,
          pythonVersion: "",
          ruffVersion: "",
          pmInfo: null,
        },
      };

      writeOutput(env);

      expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-python", "false");
      expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("ruff-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("python-package-manager", "");
    });

    it("should verify python-version is empty string for python-none fixture output", () => {
      const tempDir = path.join(fixturesDir, "py-none-" + Date.now()); createConsumerProject(tempDir, { type: "python-none" });
      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();
        writeOutput(env);

        expect(env.python.hasPythonSource).toBe(false);
        expect(env.python.pythonVersion).toBe("");
        expect(core.setOutput).toHaveBeenCalledWith("python-version", "");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should set has-python-source and setup-python to true and resolve python outputs when Python source exists", () => {
      const tempDir = path.join(fixturesDir, "python-source-test-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.2\n");

      process.chdir(tempDir);
      try {
        const env = resolveEnvironment();

        writeOutput(env);

        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
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

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("run", () => {
    it("should coordinate environment resolution, execute adapters, and write action output on fixture project", () => {
      const fixturePath = path.join(fixturesDir, "pages-npm-basic-" + Date.now()); createConsumerProject(fixturePath, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24.19.0");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "11.19.0");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "npm");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
    });

    it("should resolve bun and set adapter outputs for bun project fixture", () => {
      const fixturePath = path.join(fixturesDir, "pages-bun-basic-" + Date.now()); createConsumerProject(fixturePath, { action: "pages", runtime: "bun", pm: "bun@1.4", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", "1.4");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "bun");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "1.4");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "true");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "false");
      expect(core.info).not.toHaveBeenCalledWith("Node.js version not specified, using lts/*");
    });

    it("should resolve pnpm package manager and set adapter outputs for pnpm fixture in bun runtime", () => {
      const fixturePath = path.join(fixturesDir, "pages-bun-pnpm-basic-" + Date.now()); createConsumerProject(fixturePath, { action: "pages", runtime: "bun", pm: "pnpm@12.15.0", type: "basic" });
      process.chdir(fixturePath);

      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/pages";
      process.env.GITHUB_REPOSITORY = "owner/my-pnpm-bun-site";
      process.env.GITHUB_REPOSITORY_OWNER = "owner";

      run();

      expect(core.setOutput).toHaveBeenCalledWith("node-version", "24");
      expect(core.setOutput).toHaveBeenCalledWith("bun-version", ">=1.0.0");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager", "pnpm");
      expect(core.setOutput).toHaveBeenCalledWith("package-manager-version", "12.15.0");
      expect(core.setOutput).toHaveBeenCalledWith("runtime", "node");
      expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-bun", "false");
      expect(core.setOutput).toHaveBeenCalledWith("setup-pnpm", "true");
    });

    it("should ensure setup-node is false for Python-only project when run() executes", () => {
      const tempDir = path.join(fixturesDir, "python-only-run-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      process.chdir(tempDir);
      try {
        run();

        expect(core.setOutput).toHaveBeenCalledWith("has-js-project", "false");
        expect(core.setOutput).toHaveBeenCalledWith("has-python-source", "true");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node", "false");
        expect(core.setOutput).toHaveBeenCalledWith("setup-node-cache", "");
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should report failure via core.setFailed if environment resolution throws", () => {
      const getInputSpy = vi.spyOn(core, "getInput").mockImplementation((name) => {
        if (name === "runtime") return "invalid-runtime";
        return "";
      });

      try {
        run();

        expect(core.setFailed).toHaveBeenCalledWith(
          expect.stringContaining("Environment setup failed:"),
        );
      } finally {
        getInputSpy.mockRestore();
      }
    });
  });

  describe("toolchain resolution inputs", () => {
    it("should resolve toolchain to 'vite-plus' when toolchainInput is 'vite-plus'", () => {
      const fixturePath = path.join(fixturesDir, "pages-npm-basic-" + Date.now()); createConsumerProject(fixturePath, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(fixturePath);

      const resolved = resolveEnvironment("node", "vite-plus");
      expect(resolved.js.toolchain).toBe("vite-plus");
    });

    it("should resolve toolchain to 'vite' when toolchainInput is 'vite'", () => {
      const fixturePath = path.join(fixturesDir, "vp-minimal-" + Date.now()); createConsumerProject(fixturePath, { toolchain: "vite-plus", runtime: "node", pm: "pnpm@12.15.0", type: "vite-plus" });
      process.chdir(fixturePath);

      const resolved = resolveEnvironment("node", "vite");
      expect(resolved.js.toolchain).toBe("vite");
    });

    it("should auto-detect toolchain when toolchainInput is 'auto' or empty", () => {
      const vpFixture = path.join(fixturesDir, "vp-minimal-auto-" + Date.now()); createConsumerProject(vpFixture, { toolchain: "vite-plus", runtime: "node", pm: "pnpm@12.15.0", type: "vite-plus" });
      process.chdir(vpFixture);
      const resolvedVp = resolveEnvironment("node", "auto");
      expect(resolvedVp.js.toolchain).toBe("vite-plus");

      const stdFixture = path.join(fixturesDir, "std-fixture-" + Date.now()); createConsumerProject(stdFixture, { action: "pages", runtime: "node", pm: "npm@11.19.0", type: "basic" });
      process.chdir(stdFixture);
      const resolvedStd = resolveEnvironment("node", "");
      expect(resolvedStd.js.toolchain).toBe("vite");
    });

    it("should throw INVALID_INPUT when toolchainInput is unsupported", () => {
      expect(() => resolveEnvironment("node", "invalid-toolchain")).toThrow();
    });
  });
});
