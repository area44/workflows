import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createConsumerProject,
  generateConsumerProjectFiles,
} from "../.github/scripts/generate-consumer-project.js";

describe("Consumer Project Generator Unit & Regression Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen_consumer_test_"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("File Generation Content & Structure", () => {
    it("generates all required consumer project files with valid structure", () => {
      const files = generateConsumerProjectFiles();

      expect(files).toHaveProperty("package.json");
      expect(files).toHaveProperty("package-lock.json");
      expect(files).toHaveProperty("pyproject.toml");
      expect(files).toHaveProperty("requirements.txt");
      expect(files).toHaveProperty("index.html");
      expect(files).toHaveProperty("main.py");

      const pkg = JSON.parse(files["package.json"]);
      const lock = JSON.parse(files["package-lock.json"]);

      // Identity & Lockfile alignment
      expect(pkg.name).toBe("consumer-project");
      expect(lock.name).toBe("consumer-project");
      expect(pkg.packageManager).toBe("npm@10.8.2");

      // HTML Marker content
      expect(files["index.html"]).toContain("AREA44 Workflows Consumer Project");

      // Python Configuration & Ruff version alignment
      expect(files["pyproject.toml"]).toContain('ruff==0.17.2');
      expect(files["requirements.txt"]).toBe("ruff==0.17.2\n");
      expect(files["main.py"]).toContain('print("AREA44 consumer project Python entrypoint")');
    });

    it("applies custom generation options correctly", () => {
      const files = generateConsumerProjectFiles({
        name: "custom-app",
        packageManager: "pnpm@9.1.0",
        ruffVersion: "0.18.0",
        markerContent: "Custom Consumer Marker",
      });

      const pkg = JSON.parse(files["package.json"]);
      expect(pkg.name).toBe("custom-app");
      expect(pkg.packageManager).toBe("pnpm@9.1.0");
      expect(files["index.html"]).toContain("Custom Consumer Marker");
      expect(files["pyproject.toml"]).toContain('ruff==0.18.0');
      expect(files["requirements.txt"]).toBe("ruff==0.18.0\n");
    });
  });

  describe("Directory Creation Safety & Isolation", () => {
    it("writes consumer project files into a target directory safely", () => {
      const target = path.join(tempDir, "my_project");
      createConsumerProject(target);

      expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(target, "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(target, "pyproject.toml"))).toBe(true);
    });

    it("creates isolated independent projects in separate temporary directories", () => {
      const proj1 = path.join(tempDir, "proj1");
      const proj2 = path.join(tempDir, "proj2");

      createConsumerProject(proj1, { name: "proj-1" });
      createConsumerProject(proj2, { name: "proj-2" });

      const pkg1 = JSON.parse(fs.readFileSync(path.join(proj1, "package.json"), "utf8"));
      const pkg2 = JSON.parse(fs.readFileSync(path.join(proj2, "package.json"), "utf8"));

      expect(pkg1.name).toBe("proj-1");
      expect(pkg2.name).toBe("proj-2");
    });

    it("refuses to overwrite an existing non-empty target directory unless allowNonEmpty is true", () => {
      const target = path.join(tempDir, "non_empty");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "pre_existing.txt"), "pre-existing content");

      expect(() => createConsumerProject(target)).toThrow(
        "Refusing to generate consumer project into non-empty directory",
      );

      // Pre-existing file remains untouched
      expect(fs.readFileSync(path.join(target, "pre_existing.txt"), "utf8")).toBe("pre-existing content");

      // Succeeds when allowNonEmpty is true
      createConsumerProject(target, { allowNonEmpty: true });
      expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    });

    it("refuses to write if target path exists and is a file", () => {
      const filePath = path.join(tempDir, "existing_file.txt");
      fs.writeFileSync(filePath, "file data");

      expect(() => createConsumerProject(filePath)).toThrow(
        "exists and is not a directory",
      );
      expect(fs.readFileSync(filePath, "utf8")).toBe("file data");
    });
  });
});
