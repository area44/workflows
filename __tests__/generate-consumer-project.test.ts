import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createConsumerProject,
  generateConsumerProjectFiles,
  normalizePythonProjectName,
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
    it("generates all required consumer project files with valid structure and default project name", () => {
      const files = generateConsumerProjectFiles();

      expect(files).toHaveProperty("package.json");
      expect(files).toHaveProperty("package-lock.json");
      expect(files).toHaveProperty("pyproject.toml");
      expect(files).toHaveProperty("requirements.txt");
      expect(files).toHaveProperty("index.html");
      expect(files).toHaveProperty("main.py");

      const pkg = JSON.parse(files["package.json"]);
      const lock = JSON.parse(files["package-lock.json"]);
      const pyproject = parseToml(files["pyproject.toml"]) as any;

      // Identity & Lockfile & pyproject.toml alignment with default name
      expect(pkg.name).toBe("consumer-project");
      expect(lock.name).toBe("consumer-project");
      expect(lock.packages[""].name).toBe("consumer-project");
      expect(pyproject.project.name).toBe("consumer-project");
      expect(pkg.packageManager).toBe("npm@10.8.2");

      // HTML Marker content
      expect(files["index.html"]).toContain("AREA44 Workflows Consumer Project");

      // Python Configuration & Ruff version alignment
      expect(files["pyproject.toml"]).toContain("ruff==0.17.2");
      expect(files["requirements.txt"]).toBe("ruff==0.17.2\n");
      expect(files["main.py"]).toContain('print("AREA44 consumer project Python entrypoint")');
    });

    it("applies custom project name consistently across package.json, package-lock.json, and pyproject.toml", () => {
      const files = generateConsumerProjectFiles({
        name: "custom-app",
        pm: "npm@10.8.2",
        packageManager: "npm@10.8.2",
        ruffVersion: "0.18.0",
        markerContent: "Custom Consumer Marker",
      });

      const pkg = JSON.parse(files["package.json"]);
      const lock = JSON.parse(files["package-lock.json"]);
      const pyproject = parseToml(files["pyproject.toml"]) as any;

      expect(pkg.name).toBe("custom-app");
      expect(lock.name).toBe("custom-app");
      expect(lock.packages[""].name).toBe("custom-app");
      expect(pyproject.project.name).toBe("custom-app");

      expect(pkg.packageManager).toBe("npm@10.8.2");
      expect(files["index.html"]).toContain("Custom Consumer Marker");
      expect(files["pyproject.toml"]).toContain("ruff==0.18.0");
      expect(files["requirements.txt"]).toBe("ruff==0.18.0\n");
    });

    it("normalizes custom project names deterministically for Python package naming rules", () => {
      expect(normalizePythonProjectName("custom-app")).toBe("custom-app");
      expect(normalizePythonProjectName("@area44/my-custom_app")).toBe("area44-my-custom-app");
      expect(normalizePythonProjectName("My Custom_App!")).toBe("my-custom-app");
      expect(normalizePythonProjectName("")).toBe("consumer-project");
      expect(normalizePythonProjectName(undefined as any)).toBe("consumer-project");

      const files = generateConsumerProjectFiles({
        name: "@area44/my-custom_app!",
      });

      const pkg = JSON.parse(files["package.json"]);
      const lock = JSON.parse(files["package-lock.json"]);
      const pyproject = parseToml(files["pyproject.toml"]) as any;

      expect(pkg.name).toBe("@area44/my-custom_app!");
      expect(lock.name).toBe("@area44/my-custom_app!");
      expect(lock.packages[""].name).toBe("@area44/my-custom_app!");
      expect(pyproject.project.name).toBe("area44-my-custom-app");
    });

    it("supports generateConsumerProjectFiles with specific action, runtime, pm, and type scenario combinations", () => {
      // Pages Astro project scenario
      const pagesFiles = generateConsumerProjectFiles({
        action: "pages",
        runtime: "node",
        pm: "pnpm@12.15.0",
        type: "basic",
      });
      expect(pagesFiles).toHaveProperty("astro.config.mjs");
      expect(pagesFiles).toHaveProperty("src/pages/index.astro");
      expect(pagesFiles).toHaveProperty("pnpm-lock.yaml");
      expect(pagesFiles).not.toHaveProperty("main.py");

      // Python UV autofix scenario
      const uvFiles = generateConsumerProjectFiles({
        action: "autofix",
        type: "python-uv",
      });
      expect(uvFiles).toHaveProperty("main.py");
      expect(uvFiles).toHaveProperty("pyproject.toml");
      expect(uvFiles).toHaveProperty("uv.lock");
      expect(uvFiles).not.toHaveProperty("package.json");

      // Vite Plus scenario
      const vpFiles = generateConsumerProjectFiles({
        toolchain: "vite-plus",
        runtime: "node",
        pm: "pnpm",
        type: "vite-plus",
      });
      expect(vpFiles).toHaveProperty("vite.config.ts");
      expect(vpFiles).toHaveProperty("index.html");
      expect(vpFiles).toHaveProperty("pnpm-lock.yaml");
      expect(JSON.parse(vpFiles["package.json"]).devDependencies).toHaveProperty("vite-plus");
    });
  });

  describe("Frozen-lockfile Installation & Framework Build Integration Tests", () => {
    it("verifies Bun Astro scenario can perform frozen lockfile install and build cleanly", () => {
      const target = path.join(tempDir, "bun_astro_scenario");
      createConsumerProject(target, {
        action: "pages",
        runtime: "bun",
        pm: "bun",
        type: "basic",
      });

      expect(fs.existsSync(path.join(target, "bun.lock"))).toBe(true);
      expect(fs.readFileSync(path.join(target, "bun.lock"), "utf8").length).toBeGreaterThan(100);

      // Verify bun install --frozen-lockfile
      execSync("/usr/local/bun/bin/bun install --frozen-lockfile", { cwd: target, stdio: "ignore" });
      expect(fs.existsSync(path.join(target, "node_modules"))).toBe(true);

      // Verify real astro build command execution
      execSync("/usr/local/bun/bin/bun run build", { cwd: target, stdio: "ignore" });
      expect(fs.existsSync(path.join(target, "dist/index.html"))).toBe(true);
      expect(fs.readFileSync(path.join(target, "dist/index.html"), "utf8")).toContain(
        "AREA44 Workflows Consumer Project"
      );
    });

    it("verifies npm Vite scenario can perform npm ci and real vite build cleanly", () => {
      const target = path.join(tempDir, "npm_vite_scenario");
      createConsumerProject(target, {
        action: "pages",
        runtime: "node",
        pm: "npm",
        type: "vite",
      });

      expect(fs.existsSync(path.join(target, "package-lock.json"))).toBe(true);

      // Verify npm ci
      execSync("npm ci", { cwd: target, stdio: "ignore" });
      expect(fs.existsSync(path.join(target, "node_modules"))).toBe(true);

      // Verify real vite build command execution
      execSync("npm run build", { cwd: target, stdio: "ignore" });
      expect(fs.existsSync(path.join(target, "dist/index.html"))).toBe(true);
      expect(fs.readFileSync(path.join(target, "dist/index.html"), "utf8")).toContain(
        "AREA44 Workflows Consumer Project"
      );
    });

    it("verifies pnpm Vite+ scenario generates valid pnpm-lock.yaml for frozen pnpm install", () => {
      const target = path.join(tempDir, "pnpm_vp_scenario");
      createConsumerProject(target, {
        action: "pages",
        runtime: "node",
        pm: "pnpm",
        type: "vite-plus",
      });

      expect(fs.existsSync(path.join(target, "pnpm-lock.yaml"))).toBe(true);

      // Verify pnpm install --frozen-lockfile
      execSync("pnpm install --frozen-lockfile", { cwd: target, stdio: "ignore" });
      expect(fs.existsSync(path.join(target, "node_modules"))).toBe(true);
    });
  });

  describe("Directory Creation Safety & Overwrite Protection", () => {
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
      expect(fs.readFileSync(path.join(target, "pre_existing.txt"), "utf8")).toBe("pre-existing content");
    });

    it("refuses to overwrite colliding generated files even when allowNonEmpty is true unless overwrite is true", () => {
      const target = path.join(tempDir, "colliding");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "package.json"), "original-package-json");

      expect(() => createConsumerProject(target, { allowNonEmpty: true })).toThrow(
        "Refusing to overwrite existing generated files",
      );

      // Colliding file remains untouched
      expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).toBe("original-package-json");

      // Succeeds when overwrite: true is passed
      createConsumerProject(target, { allowNonEmpty: true, overwrite: true });
      expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).not.toBe("original-package-json");
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

  describe("CLI Invocation Safety", () => {
    const generatorScript = path.resolve(process.cwd(), ".github/scripts/generate-consumer-project.js");

    it("fails with error code 1 when CLI is invoked without a target directory argument", () => {
      let failed = false;
      let output = "";
      try {
        execSync(`node "${generatorScript}"`, { encoding: "utf8", stdio: "pipe" });
      } catch (err: any) {
        failed = true;
        output = err.stderr || err.stdout || err.message;
      }

      expect(failed).toBe(true);
      expect(output).toContain("Missing target directory argument");
    });

    it("generates project files when target directory is explicitly provided to CLI", () => {
      const target = path.join(tempDir, "cli_target");
      execSync(`node "${generatorScript}" "${target}"`, { encoding: "utf8" });

      expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(target, "index.html"))).toBe(true);
    });

    it("supports --allow-non-empty flag in CLI execution", () => {
      const target = path.join(tempDir, "cli_non_empty");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "existing.txt"), "data");

      // Without flag, CLI fails
      expect(() => {
        execSync(`node "${generatorScript}" "${target}"`, { stdio: "pipe" });
      }).toThrow();

      // With flag, CLI succeeds
      execSync(`node "${generatorScript}" "${target}" --allow-non-empty`, { encoding: "utf8" });
      expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    });

    it("refuses to overwrite colliding files via CLI unless --overwrite is passed", () => {
      const target = path.join(tempDir, "cli_colliding");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "package.json"), "pre-existing-json");

      // With --allow-non-empty alone, it fails because package.json collides
      expect(() => {
        execSync(`node "${generatorScript}" "${target}" --allow-non-empty`, { stdio: "pipe" });
      }).toThrow();

      expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).toBe("pre-existing-json");

      // With --overwrite, it succeeds
      execSync(`node "${generatorScript}" "${target}" --allow-non-empty --overwrite`, { encoding: "utf8" });
      expect(fs.readFileSync(path.join(target, "package.json"), "utf8")).not.toBe("pre-existing-json");
    });
  });
});
