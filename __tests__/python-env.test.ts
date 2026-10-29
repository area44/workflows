import { createConsumerProject } from "../.github/scripts/generate-consumer-project.js";
import * as core from "@actions/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@actions/core");

import {
  detectPythonPackageManager,
  hasPythonSource,
  isDirectoryMatchedByGlobs,
  isRuffDeclaredInProject,
  parseToml,
  PYTHON_PACKAGE_MANAGER_PRIORITY,
  resolvePythonEnvironment,
  stripTomlStringsAndComments,
} from "../src/python-env.js";

describe("Python Package Manager Detection", () => {
  const fixturesDir = os.tmpdir();

  describe("parseToml() and Standard TOML Parsing", () => {
    describe("Valid TOML constructs", () => {
      it("should parse a basic [project] table", () => {
        const content = '[project]\nname = "my-package"\nversion = "1.0.0"\n';
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toEqual({
            name: "my-package",
            version: "1.0.0",
          });
        }
      });

      it("should parse a [build-system] table", () => {
        const content =
          '[build-system]\nrequires = ["flit_core>=3.2,<4"]\nbuild-backend = "flit_core.buildapi"\n';
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data["build-system"]).toEqual({
            requires: ["flit_core>=3.2,<4"],
            "build-backend": "flit_core.buildapi",
          });
        }
      });

      it("should parse a [tool.uv] table", () => {
        const content = '[tool.uv]\ndev-dependencies = ["pytest>=7.0.0"]\n';
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.tool).toEqual({
            uv: {
              "dev-dependencies": ["pytest>=7.0.0"],
            },
          });
        }
      });

      it("should parse a valid [[tool.uv.index]] array table", () => {
        const content =
          '[[tool.uv.index]]\nname = "custom"\nurl = "https://pypi.example.com/simple"\n';
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.tool).toEqual({
            uv: {
              index: [
                {
                  name: "custom",
                  url: "https://pypi.example.com/simple",
                },
              ],
            },
          });
        }
      });

      it("should parse multiple array-table entries", () => {
        const content = `
[[tool.uv.index]]
name = "first"
url = "https://first.example.com"

[[tool.uv.index]]
name = "second"
url = "https://second.example.com"
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.tool).toEqual({
            uv: {
              index: [
                { name: "first", url: "https://first.example.com" },
                { name: "second", url: "https://second.example.com" },
              ],
            },
          });
        }
      });

      it("should parse nested tables and dotted keys", () => {
        const content = `
[tool.uv]
dev-dependencies = ["ruff==0.4.2"]

[tool.uv.sources]
foo = { path = "pkgs/foo" }
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          const tool = res.data.tool as Record<string, unknown>;
          const uv = tool.uv as Record<string, unknown>;
          expect(uv.sources).toEqual({ foo: { path: "pkgs/foo" } });
          expect(uv["dev-dependencies"]).toEqual(["ruff==0.4.2"]);
        }
      });

      it("should parse comments following values", () => {
        const content =
          '[project]\nname = "demo" # inline comment\nversion = "0.1.0" # version comment\n';
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toEqual({
            name: "demo",
            version: "0.1.0",
          });
        }
      });

      it("should handle # inside basic and literal strings without treating it as a comment", () => {
        const content = `
[project]
name = "app#1"
description = 'hash # inside literal string'
url = "https://example.com/path#section"
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toEqual({
            name: "app#1",
            description: "hash # inside literal string",
            url: "https://example.com/path#section",
          });
        }
      });

      it("should parse multiline basic and literal strings", () => {
        const content = `
[project]
readme = """
# Header
This is a multiline
basic string with # character.
"""
license-text = '''
Copyright (c) 2026
All rights reserved # comment inside literal
'''
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          const project = res.data.project as Record<string, unknown>;
          expect(project.readme).toContain("# Header");
          expect(project["license-text"]).toContain("Copyright (c) 2026");
        }
      });

      it("should parse escaped quotation marks and backslashes in basic strings", () => {
        const content = `
[project]
escaped = "quoted \\"hello\\" and backslash \\\\ path"
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect((res.data.project as Record<string, unknown>).escaped).toBe(
            'quoted "hello" and backslash \\ path',
          );
        }
      });

      it("should parse valid arrays and inline tables", () => {
        const content = `
[project]
dependencies = ["a", "b", "c"]
authors = [{ name = "Alice", email = "alice@example.com" }]
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toEqual({
            dependencies: ["a", "b", "c"],
            authors: [{ name: "Alice", email: "alice@example.com" }],
          });
        }
      });

      it("should parse empty optional tables", () => {
        const content = "[project]\n[build-system]\n[tool.uv]\n";
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toEqual({});
          expect(res.data["build-system"]).toEqual({});
          expect(res.data.tool).toEqual({ uv: {} });
        }
      });
    });

    describe("Invalid TOML syntax rejection", () => {
      it("should reject unterminated basic strings", () => {
        const content = '[project]\nname = "unterminated\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error).toBeInstanceOf(Error);
        }
      });

      it("should reject unclosed arrays", () => {
        const content = '[project]\ndependencies = ["a", "b"\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });

      it("should reject unclosed inline tables", () => {
        const content = '[project]\nauthor = { name = "Alice"\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });

      it("should reject invalid table headers", () => {
        const content = "[project\nname = 'invalid'\n";
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });

      it("should reject duplicate keys prohibited by TOML specification", () => {
        const content = '[project]\nname = "first"\nname = "second"\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });

      it("should reject invalid key-value syntax", () => {
        const content = '[project]\nname == "invalid"\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });

      it("should reject malformed multiline strings", () => {
        const content = '[project]\nreadme = """unclosed multiline string\n';
        const res = parseToml(content);
        expect(res.success).toBe(false);
      });
    });

    describe("Integration & Invariant Regression Tests", () => {
      it("should strip comments and string contents correctly in stripTomlStringsAndComments", () => {
        const content = `
# [project]
[tool.uv]
description = """
[project]
name = "string-content"
"""
notes = '''
[project]
'''
key = " [project] "
lit = ' [project] '
`;
        const stripped = stripTomlStringsAndComments(content);
        expect(stripped).not.toContain("[project]");
        expect(stripped).toContain("[tool.uv]");
      });

      it("should correctly handle escaped quotation marks and backslashes in multiline basic strings during stripping", () => {
        const content = `
[tool.uv]
description = """
Escaped quote \\""" inside multiline string
Fake header:
[project]
[build-system]
Escaped backslash before quote \\\\
"""
# Real header after string closes:
[project]
name = "real-app"
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);

        const stripped = stripTomlStringsAndComments(content);
        expect(stripped.indexOf("[project]")).toBe(stripped.lastIndexOf("[project]"));
        expect(stripped).not.toContain("[build-system]");
        expect(stripped).toContain("[project]");
      });

      it("should not falsely treat commented-out table headers as active tables", () => {
        const content = `
# [project]
# name = "commented"
[tool.uv]
dev-dependencies = ["pytest"]
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toBeUndefined();
          expect(res.data.tool).toEqual({ uv: { "dev-dependencies": ["pytest"] } });
        }
      });

      it("should not falsely extract table headers from multiline string values", () => {
        const content = `
[tool.uv]
description = """
[project]
name = "string-content"
[build-system]
"""
`;
        const res = parseToml(content);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.project).toBeUndefined();
          expect(res.data["build-system"]).toBeUndefined();
          expect((res.data.tool as Record<string, unknown>).uv).toBeDefined();
        }
      });

      it("should classify pyproject.toml as standalone pip when [project] header appears only inside a multiline string", () => {
        const tempDir = path.join(fixturesDir, "project-in-multiline-str-temp");
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
        fs.writeFileSync(
          path.join(tempDir, "pyproject.toml"),
          `[tool.uv]
description = """
[project]
name = "fake"
"""

[project.optional-dependencies]
dev = ["pytest"]
`,
        );

        try {
          const pmInfo = detectPythonPackageManager(tempDir);
          expect(pmInfo).not.toBeNull();
          expect(pmInfo?.name).toBe("pip");
          expect(pmInfo?.isStandalone).toBe(true);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });

      it("should successfully parse [[tool.uv.index]] configuration into structured object", () => {
        const tempDir = path.join(fixturesDir, "uv-index-temp");
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
        fs.writeFileSync(
          path.join(tempDir, "pyproject.toml"),
          '[[tool.uv.index]]\nname = "internal"\nurl = "https://pypi.org/simple"\n',
        );

        try {
          const pmInfo = detectPythonPackageManager(tempDir);
          expect(pmInfo).not.toBeNull();
          expect(pmInfo?.name).toBe("pip");
          expect(pmInfo?.isStandalone).toBe(true);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });
    });
  });

  describe("UV Configuration Table Type Validation Regression Tests", () => {
    it("should not trigger UV detection when tool.uv is represented as a string", () => {
      const tempDir = path.join(fixturesDir, "tool-uv-string-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "pyproject.toml"), '[tool]\nuv = "example"\n');

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).not.toBeNull();
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.isStandalone).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not leak parent root uv.toml to an independent child project with its own pyproject.toml", () => {
      const tempDir = path.join(fixturesDir, "parent-uv-toml-leak-temp");
      const childDir = path.join(tempDir, "tools/standalone");
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, ".git"), "");
      fs.writeFileSync(path.join(tempDir, "uv.toml"), "[pip]\nindex-url = 'https://root.pypi.org'\n");
      fs.writeFileSync(
        path.join(childDir, "pyproject.toml"),
        "[project]\nname = 'standalone-pkg'\nversion = '0.1.0'\n",
      );
      fs.writeFileSync(path.join(childDir, "tool.py"), "print('standalone')\n");

      try {
        const pmInfo = detectPythonPackageManager(childDir);
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.configFile).toBe("pyproject.toml");
        expect(pmInfo?.installCommands).toEqual([
          { executable: "pip", args: ["install", "-e", "."] },
        ]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should resolve uv with requirements.txt when uv.toml and requirements.txt exist without pyproject.toml", () => {
      const tempDir = path.join(fixturesDir, "uv-toml-reqs-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.toml"), "[pip]\nindex-url = 'https://pypi.org/simple'\n");
      fs.writeFileSync(path.join(tempDir, "requirements.txt"), "requests==2.31.0\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo).toEqual({
          name: "uv",
          configFile: "uv.toml",
          installCommands: [{ executable: "uv", args: ["pip", "install", "-r", "requirements.txt"] }],
          execPrefix: "uv run",
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should handle malformed uv.toml safely without crashing", () => {
      const tempDir = path.join(fixturesDir, "malformed-uv-toml-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.toml"), "[pip\nindex-url = 'broken'\n");

      try {
        const pmInfo = detectPythonPackageManager(tempDir);
        expect(pmInfo?.name).toBe("pip");
        expect(pmInfo?.isStandalone).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should throw actionable error when uv.lock is combined with uv.toml without valid pyproject.toml", () => {
      const tempDir = path.join(fixturesDir, "uv-lock-uv-toml-orphaned-temp");
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "main.py"), "print('hello')\n");
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n");
      fs.writeFileSync(path.join(tempDir, "uv.toml"), "[pip]\nindex-url = 'https://pypi.org/simple'\n");

      try {
        expect(() => detectPythonPackageManager(tempDir)).toThrow(
          "Invalid Python project configuration: 'uv.lock' was detected without a valid 'pyproject.toml' project or workspace configuration ('[project]', '[build-system]', or '[tool.uv.workspace]'). 'uv sync' requires a valid 'pyproject.toml' file.",
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should ensure independent child project isolates package manager and lockfiles from parent workspace", () => {
      const tempDir = path.join(fixturesDir, "workspace-vs-independent-isolation-temp");
      const memberDir = path.join(tempDir, "packages/sub");
      const independentDir = path.join(tempDir, "tools/standalone");

      fs.mkdirSync(memberDir, { recursive: true });
      fs.mkdirSync(independentDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, ".git"), "");

      // Workspace Root
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[project]\nrequires-python = '>=3.11'\n\n[tool.uv.workspace]\nmembers = ['packages/*']\n\n[dependency-groups]\ndev = ['ruff==0.4.2']\n",
      );
      fs.writeFileSync(
        path.join(tempDir, "uv.lock"),
        'version = 1\n\n[[package]]\nname = "ruff"\nversion = "0.4.2"\n',
      );

      // Workspace Member
      fs.writeFileSync(
        path.join(memberDir, "pyproject.toml"),
        "[project]\nname = 'sub'\nversion = '0.1.0'\n",
      );
      fs.writeFileSync(path.join(memberDir, "sub.py"), "print('sub')\n");

      // Independent Child
      fs.writeFileSync(
        path.join(independentDir, "pyproject.toml"),
        "[project]\nname = 'standalone-tool'\nversion = '0.1.0'\ndependencies = ['requests']\n",
      );
      fs.writeFileSync(path.join(independentDir, "tool.py"), "print('tool')\n");

      try {
        const memberEnv = resolvePythonEnvironment(memberDir);
        expect(memberEnv.packageManager?.name).toBe("uv");
        expect(memberEnv.packageManager?.lockfile).toBe("uv.lock");

        const independentEnv = resolvePythonEnvironment(independentDir);
        expect(independentEnv.packageManager?.name).toBe("pip");
        expect(independentEnv.packageManager?.lockfile).toBeUndefined();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should respect workspace exclude patterns and not assign workspace lockfile to excluded packages", () => {
      const tempDir = path.join(fixturesDir, "uv-workspace-exclude-temp");
      const memberDir = path.join(tempDir, "packages/included");
      const excludedDir = path.join(tempDir, "packages/excluded");
      fs.mkdirSync(memberDir, { recursive: true });
      fs.mkdirSync(excludedDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, ".git"), "");
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[tool.uv.workspace]\nmembers = ['packages/*']\nexclude = ['packages/excluded']\n",
      );
      fs.writeFileSync(path.join(tempDir, "uv.lock"), "version = 1\n");
      fs.writeFileSync(path.join(memberDir, "mem.py"), "print('mem')\n");
      fs.writeFileSync(
        path.join(memberDir, "pyproject.toml"),
        "[project]\nname = 'included-pkg'\nversion = '0.1.0'\n",
      );
      fs.writeFileSync(path.join(excludedDir, "ex.py"), "print('ex')\n");
      fs.writeFileSync(
        path.join(excludedDir, "pyproject.toml"),
        "[project]\nname = 'excluded-pkg'\nversion = '0.1.0'\n",
      );

      try {
        const memberPmInfo = detectPythonPackageManager(memberDir);
        expect(memberPmInfo?.name).toBe("uv");
        expect(memberPmInfo?.lockfile).toBe("uv.lock");

        const excludedPmInfo = detectPythonPackageManager(excludedDir);
        expect(excludedPmInfo?.name).toBe("pip");
        expect(excludedPmInfo?.lockfile).toBeUndefined();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should resolve workspace member environment end-to-end via public resolvePythonEnvironment()", () => {
      const tempDir = path.join(fixturesDir, "resolve-env-workspace-temp");
      const pkgDir = path.join(tempDir, "packages/sub");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, ".git"), "");
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        "[project]\nrequires-python = '>=3.11'\n\n[tool.uv.workspace]\nmembers = ['packages/*']\n\n[dependency-groups]\ndev = ['ruff==0.4.2']\n",
      );
      fs.writeFileSync(
        path.join(tempDir, "uv.lock"),
        'version = 1\n\n[[package]]\nname = "ruff"\nversion = "0.4.2"\n',
      );
      fs.writeFileSync(path.join(pkgDir, "sub.py"), "print('sub')\n");
      fs.writeFileSync(
        path.join(pkgDir, "pyproject.toml"),
        "[project]\nname = 'sub'\nversion = '0.1.0'\n",
      );

      try {
        const resolved = resolvePythonEnvironment(pkgDir);
        expect(resolved.detected).toBe(true);
        expect(resolved.packageManager?.name).toBe("uv");
        expect(resolved.packageManager?.installCommands).toEqual([{ executable: "uv", args: ["sync"] }]);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  function createConsumerProjectInTmp(options: any): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(fixturesDir, "py-proj-"));
    createConsumerProject(dir, options);
    return {
      dir,
      cleanup: () => {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    };
  }

  describe("resolvePythonEnvironment()", () => {
    it("should return detected=false when no python source exists", () => {
      const proj = createConsumerProjectInTmp({ type: "python-none" });
      try {
        const resolved = resolvePythonEnvironment(proj.dir);
        expect(resolved).toEqual({
          detected: false,
          packageManager: null,
        });
      } finally {
        proj.cleanup();
      }
    });

    it("should resolve package manager when python source exists", () => {
      const proj = createConsumerProjectInTmp({ type: "python-uv" });
      try {
        const resolved = resolvePythonEnvironment(proj.dir);
        expect(resolved.detected).toBe(true);
        expect(resolved.packageManager?.name).toBe("uv");
      } finally {
        proj.cleanup();
      }
    });
  });

  describe("hasPythonSource()", () => {
    it("should return true when .py file exists in directory", () => {
      const proj = createConsumerProjectInTmp({ type: "python-uv" });
      try {
        expect(hasPythonSource(proj.dir)).toBe(true);
      } finally {
        proj.cleanup();
      }
    });

    it("should return true when .pyi file exists in directory", () => {
      const tempDir = fs.mkdtempSync(path.join(fixturesDir, "pyi-temp-"));
      fs.writeFileSync(path.join(tempDir, "types.pyi"), "# stubs\n");

      try {
        expect(hasPythonSource(tempDir)).toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return false when directory has no python source files", () => {
      const proj = createConsumerProjectInTmp({ type: "python-none" });
      try {
        expect(hasPythonSource(proj.dir)).toBe(false);
      } finally {
        proj.cleanup();
      }
    });
  });

  describe("isRuffDeclaredInProject()", () => {
    it("should detect ruff declared in pyproject.toml or requirements.txt", () => {
      const projUv = createConsumerProjectInTmp({ type: "python-uv" });
      const projPip = createConsumerProjectInTmp({ type: "python-pip", ruffVersion: "0.17.2" });
      const projNone = createConsumerProjectInTmp({ type: "python-none" });

      try {
        expect(isRuffDeclaredInProject(projUv.dir)).toBe(true);
        expect(isRuffDeclaredInProject(projPip.dir)).toBe(true);
        expect(isRuffDeclaredInProject(projNone.dir)).toBe(false);
      } finally {
        projUv.cleanup();
        projPip.cleanup();
        projNone.cleanup();
      }
    });
  });

  describe("PYTHON_PACKAGE_MANAGER_PRIORITY Constant", () => {
    it("should define priority order as uv > pip", () => {
      expect(PYTHON_PACKAGE_MANAGER_PRIORITY).toEqual(["uv", "pip"]);
    });
  });
});
