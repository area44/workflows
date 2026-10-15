import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  buildFormatExecutionPlan,
  detectToolConfiguration,
  SUPPORTED_FORMATS,
} from "../src/format-mapping";

describe("Format-to-Tool Mapping & Configuration Detection", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.resolve(
      originalCwd,
      "__tests__/fixtures/autofix/temp-format-map-" + Math.random().toString(36).substring(2, 9),
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Supported Formats Definitions", () => {
    it("should define file extensions for all supported formats", () => {
      expect(SUPPORTED_FORMATS.javascript.extensions).toEqual([".js", ".mjs", ".cjs", ".jsx"]);
      expect(SUPPORTED_FORMATS.typescript.extensions).toEqual([".ts", ".mts", ".cts", ".tsx"]);
      expect(SUPPORTED_FORMATS.python.extensions).toEqual([".py", ".pyi"]);
      expect(SUPPORTED_FORMATS.json.extensions).toEqual([".json"]);
      expect(SUPPORTED_FORMATS.jsonc.extensions).toEqual([".jsonc"]);
      expect(SUPPORTED_FORMATS.yaml.extensions).toEqual([".yaml", ".yml"]);
      expect(SUPPORTED_FORMATS.toml.extensions).toEqual([".toml"]);
      expect(SUPPORTED_FORMATS.markdown.extensions).toEqual([".md", ".markdown"]);
    });
  });

  describe("Tool Configuration Detection", () => {
    it("should detect package.json scripts", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ scripts: { format: "echo format" } }),
      );
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasPackageScripts).toBe(true);
    });

    it("should detect Biome from biome.json file", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasBiomeConfig).toBe(true);
    });

    it("should detect Biome from package.json devDependencies", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { "@biomejs/biome": "^1.8.0" } }),
      );
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasBiomeDep).toBe(true);
    });

    it("should detect Prettier from .prettierrc file and prettier-plugin-toml", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { prettier: "^3.0.0", "prettier-plugin-toml": "^2.0.0" } }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasPrettierConfig).toBe(true);
      expect(detection.hasPrettierDep).toBe(true);
      expect(detection.hasPrettierTomlPlugin).toBe(true);
    });

    it("should detect Taplo from taplo.toml", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "taplo.toml"), "");
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasTaploConfig).toBe(true);
    });

    it("should detect dprint from dprint.json", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "dprint.json"), "{}");
      const detection = detectToolConfiguration(tempDir);
      expect(detection.hasDprintConfig).toBe(true);
    });
  });

  describe("Format Execution Plan Rules & Precedence", () => {
    it("Rule 1: Package scripts take primary precedence over standalone tools", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { check: "echo check" },
          devDependencies: { prettier: "^3.0.0", "@biomejs/biome": "^1.8.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const plan = buildFormatExecutionPlan(tempDir, "npm");

      const jsSel = plan.selections.find((s) => s.format === "javascript");
      const jsonSel = plan.selections.find((s) => s.format === "json");
      const yamlSel = plan.selections.find((s) => s.format === "yaml");

      expect(jsSel?.tool).toBe("package-scripts");
      expect(jsonSel?.tool).toBe("package-scripts");
      expect(yamlSel?.tool).toBe("package-scripts");
      expect(plan.commands).toHaveLength(0);
    });

    it("Rule 2: Python always maps to Ruff", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      const plan = buildFormatExecutionPlan(tempDir, "npm");
      const pySel = plan.selections.find((s) => s.format === "python");
      expect(pySel?.tool).toBe("ruff");
    });

    it("Rule 3: Biome + Prettier coexistence assigns JS/TS/JSON to Biome and YAML/Markdown to Prettier", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }),
      );
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const plan = buildFormatExecutionPlan(tempDir, "npm");

      const jsSel = plan.selections.find((s) => s.format === "javascript");
      const jsonSel = plan.selections.find((s) => s.format === "json");
      const yamlSel = plan.selections.find((s) => s.format === "yaml");
      const mdSel = plan.selections.find((s) => s.format === "markdown");

      expect(jsSel?.tool).toBe("biome");
      expect(jsonSel?.tool).toBe("biome");
      expect(yamlSel?.tool).toBe("prettier");
      expect(mdSel?.tool).toBe("prettier");

      expect(plan.commands).toHaveLength(2);

      const biomeCmd = plan.commands.find((c) => c.tool === "biome");
      const prettierCmd = plan.commands.find((c) => c.tool === "prettier");

      expect(biomeCmd?.command).toBe("npx biome check --write .");
      expect(biomeCmd?.formats).toEqual(["javascript", "typescript", "json", "jsonc"]);

      expect(prettierCmd?.command).toBe('npx prettier --write "**/*.{yaml,yml,md,markdown}"');
      expect(prettierCmd?.formats).toEqual(["yaml", "markdown"]);
    });

    it("Rule 4: TOML without plugin or taplo is not assigned to standard Prettier", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const plan = buildFormatExecutionPlan(tempDir, "npm");

      const tomlSel = plan.selections.find((s) => s.format === "toml");
      expect(tomlSel).toBeUndefined();

      const prettierCmd = plan.commands.find((c) => c.tool === "prettier");
      expect(prettierCmd?.command).not.toContain("toml");
    });

    it("Rule 5: TOML with prettier-plugin-toml includes TOML in Prettier execution command", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          devDependencies: { prettier: "^3.0.0", "prettier-plugin-toml": "^2.0.0" },
        }),
      );
      fs.writeFileSync(path.join(tempDir, ".prettierrc"), "{}");

      const plan = buildFormatExecutionPlan(tempDir, "npm");

      const tomlSel = plan.selections.find((s) => s.format === "toml");
      expect(tomlSel?.tool).toBe("prettier");

      const prettierCmd = plan.commands.find((c) => c.tool === "prettier");
      expect(prettierCmd?.command).toContain("toml");
    });

    it("Rule 6: TOML with taplo config uses Taplo command", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "taplo.toml"), "");

      const plan = buildFormatExecutionPlan(tempDir, "npm");

      const tomlSel = plan.selections.find((s) => s.format === "toml");
      expect(tomlSel?.tool).toBe("taplo");

      const taploCmd = plan.commands.find((c) => c.tool === "taplo");
      expect(taploCmd?.command).toBe("npx taplo fmt");
    });

    it("Rule 7: Package manager runner prefix generation for pnpm and bun", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tempDir, "biome.json"), "{}");

      const pnpmPlan = buildFormatExecutionPlan(tempDir, "pnpm");
      expect(pnpmPlan.commands[0].command).toBe("pnpm exec biome check --write .");

      const bunPlan = buildFormatExecutionPlan(tempDir, "bun");
      expect(bunPlan.commands[0].command).toBe("bunx biome check --write .");
    });
  });
});
