import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  detectPythonPackageManager,
  getPythonRuffCommands,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  type PythonPackageManagerInfo,
} from "../src/python-env.js";

describe("Python Package Manager Detection & Ruff Command Generation", () => {
  const fixturesDir = path.resolve(process.cwd(), "__tests__/fixtures/autofix/python");

  describe("PYTHON_PACKAGE_MANAGER_PRIORITY Constant", () => {
    it("should define priority order as uv > poetry > pdm > pip", () => {
      expect(PYTHON_PACKAGE_MANAGER_PRIORITY).toEqual(["uv", "poetry", "pdm", "pip"]);
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

    it("should detect poetry package manager from poetry fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "poetry"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("poetry");
      expect(pmInfo?.lockfile).toBe("poetry.lock");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommand).toBe("poetry install");
      expect(pmInfo?.execPrefix).toBe("poetry run");
    });

    it("should detect pdm package manager from pdm fixture directory", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "pdm"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("pdm");
      expect(pmInfo?.lockfile).toBe("pdm.lock");
      expect(pmInfo?.configFile).toBe("pyproject.toml");
      expect(pmInfo?.installCommand).toBe("pdm install");
      expect(pmInfo?.execPrefix).toBe("pdm run");
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

    it("should select uv as highest priority when conflicting lockfiles exist", () => {
      const pmInfo = detectPythonPackageManager(path.join(fixturesDir, "conflicting"));
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("uv");
    });

    it("should safely handle pyproject.toml with tool-only configuration ([tool.ruff])", () => {
      const pmInfo = detectPythonPackageManager(process.cwd()); // repo root has tool.ruff pyproject.toml
      expect(pmInfo).not.toBeNull();
      expect(pmInfo?.name).toBe("pip");
      expect(pmInfo?.installCommand).toBe("pip install ruff");
      expect(pmInfo?.execPrefix).toBe("");
    });

    it("should append pip install ruff when requirements.txt does not contain ruff", () => {
      const tempDir = path.join(fixturesDir, "pip-no-ruff-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.installCommand).toBe("pip install -r requirements.txt && pip install ruff");
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
      expect(getPythonRuffCommands(uvInfo, "check")).toEqual(["uv run ruff check ."]);
      expect(getPythonRuffCommands(pipInfo, "check")).toEqual(["ruff check ."]);
    });

    it("should generate ruff format check command for format-check mode", () => {
      expect(getPythonRuffCommands(uvInfo, "format-check")).toEqual([
        "uv run ruff format --check .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "format-check")).toEqual(["ruff format --check ."]);
    });

    it("should generate ruff format command for format mode", () => {
      expect(getPythonRuffCommands(uvInfo, "format")).toEqual(["uv run ruff format ."]);
      expect(getPythonRuffCommands(pipInfo, "format")).toEqual(["ruff format ."]);
    });

    it("should generate ruff format and ruff check --fix commands for autofix mode", () => {
      expect(getPythonRuffCommands(uvInfo, "autofix")).toEqual([
        "uv run ruff format .",
        "uv run ruff check --fix .",
      ]);
      expect(getPythonRuffCommands(pipInfo, "autofix")).toEqual([
        "ruff format .",
        "ruff check --fix .",
      ]);
    });
  });
});
