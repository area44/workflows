import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PYTHON_VERSION,
  detectPythonPackageManager,
  extractRuffVersionSpecifier,
  hasPythonSource,
  isRuffDeclaredInProject,
  parsePythonVersionFromConstraint,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  resolvePythonEnvironment,
  resolvePythonVersion,
  resolveRuffVersion,
} from "../src/python-env.js";

describe("Python Package Manager Detection & Ruff Version Resolution", () => {
  const fixturesDir = path.resolve(process.cwd(), "__tests__/fixtures/autofix/python");

  describe("resolvePythonEnvironment()", () => {
    it("should return hasPythonSource=false and empty fields when no python source exists", () => {
      const resolved = resolvePythonEnvironment(path.join(fixturesDir, "none"));
      expect(resolved).toEqual({
        hasPythonSource: false,
        pythonVersion: "",
        ruffVersion: "",
        pmInfo: null,
      });
    });

    it("should resolve python version, package manager, and ruff version when python source exists", () => {
      const resolved = resolvePythonEnvironment(path.join(fixturesDir, "uv"));
      expect(resolved.hasPythonSource).toBe(true);
      expect(resolved.pythonVersion).toBe("3.12");
      expect(resolved.ruffVersion).toBe("");
      expect(resolved.pmInfo?.name).toBe("uv");
    });
  });

  describe("hasPythonSource()", () => {
    it("should return true when .py file exists in directory", () => {
      expect(hasPythonSource(path.join(fixturesDir, "uv"))).toBe(true);
    });

    it("should return true when .pyi file exists in directory", () => {
      const tempDir = path.join(fixturesDir, "pyi-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "types.pyi"), "# stubs\n");

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return true when repository contains only tests/test_example.py", () => {
      const tempDir = path.join(fixturesDir, "tests-py-temp");
      fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "tests/test_example.py"), "def test_foo(): pass\n");

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return true when repository contains only __tests__/types.pyi", () => {
      const tempDir = path.join(fixturesDir, "dunder-tests-pyi-temp");
      fs.mkdirSync(path.join(tempDir, "__tests__"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "__tests__/types.pyi"), "# stubs\n");

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should traverse nested tests/ directory for .py files", () => {
      const tempDir = path.join(fixturesDir, "nested-tests-py-temp");
      fs.mkdirSync(path.join(tempDir, "tests/unit/deep"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "tests/unit/deep/test_deep.py"),
        "def test_deep(): pass\n",
      );

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should traverse nested __tests__/ directory for .pyi files", () => {
      const tempDir = path.join(fixturesDir, "nested-dunder-tests-pyi-temp");
      fs.mkdirSync(path.join(tempDir, "__tests__/integration/sub"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "__tests__/integration/sub/types.pyi"), "# stubs\n");

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return false when directory has no python source files", () => {
      expect(hasPythonSource(path.join(fixturesDir, "none"))).toBe(false);
    });

    it("should return false for JS/TS-only repository", () => {
      const tempDir = path.join(fixturesDir, "js-ts-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), '{"name": "app"}');
      fs.writeFileSync(path.join(tempDir, "index.ts"), 'console.log("hello");');

      try {
        expect(hasPythonSource(tempDir)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return false when repository contains pyproject.toml but no .py or .pyi files", () => {
      const tempDir = path.join(fixturesDir, "pyproject-no-py-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), '[project]\nname = "my-app"\n');

      try {
        expect(hasPythonSource(tempDir)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return false when repository contains only [tool.ruff] configuration and no .py or .pyi files", () => {
      const tempDir = path.join(fixturesDir, "tool-ruff-no-py-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), '[tool.ruff]\nline-length = 88\n');

      try {
        expect(hasPythonSource(tempDir)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should ignore python files inside excluded directories like node_modules or .venv", () => {
      const tempDir = path.join(fixturesDir, "excluded-temp");
      fs.mkdirSync(path.join(tempDir, "node_modules/pkg"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, ".venv/lib"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "node_modules/pkg/index.py"), "print('ignored')");
      fs.writeFileSync(path.join(tempDir, ".venv/lib/site.py"), "print('ignored')");

      try {
        expect(hasPythonSource(tempDir)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("resolvePythonVersion() and constraint parsing", () => {
    it("should parse python versions from constraint strings", () => {
      expect(parsePythonVersionFromConstraint(">=3.11")).toBe("3.11");
      expect(parsePythonVersionFromConstraint("^3.12")).toBe("3.12");
      expect(parsePythonVersionFromConstraint("3.12.1")).toBe("3.12.1");
      expect(parsePythonVersionFromConstraint("python-3.11.4")).toBe("3.11.4");
      expect(parsePythonVersionFromConstraint("")).toBeUndefined();
    });

    it("should read version from .python-version if present", () => {
      const tempDir = path.join(fixturesDir, "pyver-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, ".python-version"), "3.11\n");
      fs.writeFileSync(path.join(tempDir, "main.py"), "print(1)\n");

      try {
        expect(resolvePythonVersion(tempDir)).toBe("3.11");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should fallback to default python version 3.12 when no version file or constraint is present", () => {
      expect(resolvePythonVersion(path.join(fixturesDir, "none"))).toBe(DEFAULT_PYTHON_VERSION);
    });

  });

  describe("resolveRuffVersion() and specifier extraction", () => {
    it("should extract exact pin or version constraint from specifiers", () => {
      expect(extractRuffVersionSpecifier("ruff==0.4.2")).toBe("0.4.2");
      expect(extractRuffVersionSpecifier("ruff = '0.4.2'")).toBe("0.4.2");
      expect(extractRuffVersionSpecifier("ruff = '^0.4.0'")).toBeUndefined();
      expect(extractRuffVersionSpecifier("ruff>=0.3.0,<0.5.0")).toBeUndefined();
      expect(extractRuffVersionSpecifier("0.4.1")).toBe("0.4.1");
      expect(extractRuffVersionSpecifier("")).toBeUndefined();
    });

    it("should resolve locked ruff version from uv.lock", () => {
      const tempDir = path.join(fixturesDir, "ruff-uv-lock-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "uv.lock"),
        'version = 1\n\n[[package]]\nname = "ruff"\nversion = "0.4.2"\n',
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("0.4.2");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should resolve ruff version from uv.lock when dependency reference appears before package entry", () => {
      const tempDir = path.join(fixturesDir, "ruff-uv-deps-first-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "uv.lock"),
        'version = 1\n\n[[package]]\nname = "my-app"\nversion = "0.1.0"\ndependencies = [\n  { name = "ruff" },\n]\n\n[[package]]\nname = "ruff"\nversion = "0.4.2"\n',
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("0.4.2");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return empty string when uv.lock has no ruff package entry or malformed entry", () => {
      const tempDir = path.join(fixturesDir, "ruff-uv-malformed-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "uv.lock"),
        'version = 1\n\n[[package]]\nname = "my-app"\nversion = "0.1.0"\ndependencies = [\n  { name = "ruff" },\n]\n',
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should resolve ruff version from pyproject.toml with exact pin", () => {
      const tempDir = path.join(fixturesDir, "ruff-pin-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[project]\ndependencies = ['ruff==0.4.2']\n",
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("0.4.2");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return empty string for complex range constraints so ruff-action uses standard version resolution", () => {
      const tempDir = path.join(fixturesDir, "ruff-range-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[project.optional-dependencies]\ndev = ['ruff>=0.3.0,<0.5.0']\n",
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should resolve ruff version from requirements.txt", () => {
      const tempDir = path.join(fixturesDir, "ruff-req-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "ruff==0.4.0\nrequests==2.31.0\n");

      try {
        expect(resolveRuffVersion(tempDir)).toBe("0.4.0");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return empty string when pyproject.toml contains only [tool.ruff] configuration", () => {
      const tempDir = path.join(fixturesDir, "ruff-tool-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[tool.ruff]\nline-length = 88\n[tool.ruff.lint]\nselect = ['E']\n",
      );

      try {
        expect(resolveRuffVersion(tempDir)).toBe("");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return empty string when no manifest or ruff declaration exists", () => {
      expect(resolveRuffVersion(path.join(fixturesDir, "none"))).toBe("");
    });
  });

  describe("isRuffDeclaredInProject()", () => {
    it("should detect ruff declared in pyproject.toml or requirements.txt", () => {
      expect(isRuffDeclaredInProject(path.join(fixturesDir, "uv"))).toBe(true);
      expect(isRuffDeclaredInProject(path.join(fixturesDir, "pip"))).toBe(true);
      expect(isRuffDeclaredInProject(path.join(fixturesDir, "none"))).toBe(false);
    });

    it("should return false when pyproject.toml contains only [tool.ruff] configuration without dependency declaration", () => {
      const tempDir = path.join(fixturesDir, "tool-ruff-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n[tool.ruff.lint]\nselect = ['E']\n");
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        expect(isRuffDeclaredInProject(tempDir)).toBe(false);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("PYTHON_PACKAGE_MANAGER_PRIORITY Constant", () => {
    it("should define priority order as uv > pip", () => {
      expect(PYTHON_PACKAGE_MANAGER_PRIORITY).toEqual(["uv", "pip"]);
    });
  });

  describe("detectPythonPackageManager()", () => {
    it("should detect uv package manager from uv fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "uv"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("uv");
      expect(pmInfo?.lockfile).toBe("uv.lock");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommands).toEqual([
        { executable: "uv", args: ["sync"] },
      ]);
      expect(pmInfo?.execPrefix).toBe("uv run");
    });

    it("should detect uv when uv.lock is present but pyproject.toml is missing", () => {
      const tempDir = path.join(fixturesDir, "uv-lock-no-pyproject-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("uv");
        expect(pmInfo?.lockfile).toBe("uv.lock");
        expect(pmInfo?.configFile).toBeUndefined();
        expect(pmInfo?.installCommands).toEqual([
          { executable: "uv", args: ["sync"] },
        ]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should detect uv when pyproject.toml has [tool.uv] table but uv.lock is missing", () => {
      const tempDir = path.join(fixturesDir, "uv-config-no-lock-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[tool.uv]\ndev-dependencies = []\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("uv");
        expect(pmInfo?.lockfile).toBeUndefined();
        expect(pmInfo?.configFile).toBe("pyproject.toml");
        expect(pmInfo?.installCommands).toEqual([
          { executable: "uv", args: ["sync"] },
        ]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should detect pip package manager from pip fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "pip"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("pip");
      expect(pmInfo?.lockfile).toBe("requirements.txt");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommands).toEqual([
        { executable: "pip", args: ["install", "-r", "requirements.txt"] },
        { executable: "pip", args: ["install", "-e", "."] },
      ]);
      expect(pmInfo?.execPrefix).toBe("");
    });

    it("should return standalone pip info when Python source exists without manifest or lockfile", () => {
      const tempDir = path.join(fixturesDir, "standalone-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "app.py"), "print('standalone')\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.isStandalone).toBe(true);
        expect(pmInfo?.installCommands).toEqual([]);
        expect(pmInfo?.execPrefix).toBe("");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return null for JS/TS repositories with tool-only pyproject.toml ([tool.ruff]) and no .py files", () => {
      const tempDir = path.join(fixturesDir, "js-only-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "package.json"), '{"name": "js-proj"}');
      fs.writeFileSync(path.join(tempDir, "index.ts"), 'console.log("hello");');
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).toBeNull();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should select uv as highest priority when conflicting lockfiles exist and .py file is present", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "conflicting"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("uv");
    });

    it("should install requirements.txt without mutating project environment when requirements.txt does not contain ruff", () => {
      const tempDir = path.join(fixturesDir, "pip-no-ruff-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.installCommands).toEqual([
          { executable: "pip", args: ["install", "-r", "requirements.txt"] },
        ]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return null when no python source files exist, even if pyproject.toml exists", () => {
      const tempDir = path.join(fixturesDir, "manifest-no-source-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), "[project]\nname = 'demo'\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).toBeNull();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return null when no python project configuration or lockfiles exist", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "none"));
      expect(pmInfo).toBeNull();
    });
  });
});
