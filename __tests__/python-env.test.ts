import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PYTHON_VERSION,
  detectPythonPackageManager,
  getPythonRuffCommands,
  hasPythonSource,
  isExecutableAvailable,
  isRuffDeclaredInProject,
  parsePythonVersionFromConstraint,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  resolvePythonVersion,
  type PythonPackageManagerInfo,
} from "../src/python-env.js";

describe("Python Package Manager Detection & Ruff Command Generation", () => {
  describe("hasPythonSource()", () => {
    it("should return true when .py file exists in directory", () => {
      expect(hasPythonSource(path.join(fixturesDir, "uv"))).toBe(true);
    });

    it("should return false when directory has no python source files", () => {
      expect(hasPythonSource(path.join(fixturesDir, "none"))).toBe(false);
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
  const fixturesDir = path.resolve(process.cwd(), "__tests__/fixtures/autofix/python");

  describe("PYTHON_PACKAGE_MANAGER_PRIORITY Constant", () => {
    it("should define priority order as uv > pip", () => {
      expect(PYTHON_PACKAGE_MANAGER_PRIORITY).toEqual(["uv", "pip"]);
    });
  });

  describe("isExecutableAvailable()", () => {
    it("should return true for common system binary like node", () => {
      expect(isExecutableAvailable("node")).toBe(true);
    });

    it("should return false for non-existent binary", () => {
      expect(isExecutableAvailable("non_existent_binary_xyz_123")).toBe(false);
    });

    it("should return false for invalid binary names with dangerous characters", () => {
      expect(isExecutableAvailable("node; rm -rf /")).toBe(false);
    });
  });

  describe("detectPythonPackageManager()", () => {
    it("should detect uv package manager from uv fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "uv"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("uv");
      expect(pmInfo?.lockfile).toBe("uv.lock");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommand).toBe("uv sync");
      expect(pmInfo?.execPrefix).toBe("uv run");
    });


    it("should detect pip package manager from pip fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "pip"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("pip");
      expect(pmInfo?.lockfile).toBe("requirements.txt");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommand).toBe("pip install -r requirements.txt");
      expect(pmInfo?.execPrefix).toBe("");
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

    it("should select uv as highest priority when conflicting lockfiles exist", () => {
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
        expect(pmInfo?.installCommand).toBe("pip install -r requirements.txt");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return null when no python project configuration or lockfiles exist", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "none"));
      expect(pmInfo).toBeNull();
    });
  });

  describe("getPythonRuffCommands()", () => {
    const uvInfo: PythonPackageManagerInfo = {
      name: "uv",
      installCommand: "uv sync",
      execPrefix: "uv run",
    };

    const pipInfo: PythonPackageManagerInfo = {
      name: "pip",
      installCommand: "pip install -r requirements.txt",
      execPrefix: "",
    };

    it("should generate ruff check command for check mode", () => {
      expect(getPythonRuffCommands(uvInfo, "check", path.join(fixturesDir, "uv"))).toEqual([
        "uv run ruff check .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "check", path.join(fixturesDir, "pip"))).toEqual([
        "ruff check .",
      ]);
    });

    it("should generate ruff format check command for format-check mode", () => {
      expect(getPythonRuffCommands(uvInfo, "format-check", path.join(fixturesDir, "uv"))).toEqual([
        "uv run ruff format --check .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "format-check", path.join(fixturesDir, "pip"))).toEqual([
        "ruff format --check .",
      ]);
    });

    it("should generate ruff format command for format mode", () => {
      expect(getPythonRuffCommands(uvInfo, "format", path.join(fixturesDir, "uv"))).toEqual([
        "uv run ruff format .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "format", path.join(fixturesDir, "pip"))).toEqual([
        "ruff format .",
      ]);
    });

    it("should generate ruff format and ruff check --fix commands in autofix mode", () => {
      expect(getPythonRuffCommands(uvInfo, "autofix", path.join(fixturesDir, "uv"))).toEqual([
        "uv run ruff format .",
        "uv run ruff check --fix .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "autofix", path.join(fixturesDir, "pip"))).toEqual([
        "ruff format .",
        "ruff check --fix .",
      ]);
    });

    it("should use uvx fallback when ruff is not declared as a project dependency", () => {
      const standaloneInfo: PythonPackageManagerInfo = {
        name: "pip",
        installCommand: "",
        execPrefix: "",
        isStandalone: true,
      };
      const cmds = getPythonRuffCommands(standaloneInfo, "autofix", path.join(fixturesDir, "none"));
      expect(cmds[0]).toMatch(/^(uvx |pipx run |ruff )?ruff format \.$/);
      expect(cmds[1]).toMatch(/^(uvx |pipx run |ruff )?ruff check --fix \.$/);
    });
  });
});
