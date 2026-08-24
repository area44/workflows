import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const scriptPath = path.resolve(process.cwd(), "src/run-lint-format.sh");
const fixturesDir = path.resolve(process.cwd(), "__tests__/fixtures");

function createMockBinDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "node_modules/.tmp_bin_"));
  const mockScript = `#!/usr/bin/env bash\necho "$0 $@"\nexit 0\n`;

  for (const bin of ["npm", "pnpm", "bun"]) {
    const binPath = path.join(tmpDir, bin);
    fs.writeFileSync(binPath, mockScript, { mode: 0o755 });
  }

  return tmpDir;
}

function runLintFormatScript(cwd: string, envOverrides: Record<string, string> = {}, mockBinDir?: string) {
  const extraPath = mockBinDir ? `${mockBinDir}:${process.env.PATH}` : process.env.PATH;
  return execFileSync("bash", [scriptPath], {
    cwd,
    env: { ...process.env, PATH: extraPath, ...envOverrides },
    encoding: "utf8",
  });
}

describe("run-lint-format shell script", () => {
  describe("Fixture-based test cases", () => {
    it("should run format and lint scripts for lint-format/npm/basic fixture", () => {
      const mockBinDir = createMockBinDir();
      try {
        const fixturePath = path.join(fixturesDir, "lint-format/npm/basic");
        const stdout = runLintFormatScript(fixturePath, { PACKAGE_MANAGER: "npm" }, mockBinDir);

        expect(stdout).toContain("Detected lint/format scripts: format, lint");
        expect(stdout).toContain("Executing: npm run format");
        expect(stdout).toContain("Executing: npm run lint");
      } finally {
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });

    it("should run format and lint scripts using pnpm for lint-format/pnpm/basic fixture", () => {
      const mockBinDir = createMockBinDir();
      try {
        const fixturePath = path.join(fixturesDir, "lint-format/pnpm/basic");
        const stdout = runLintFormatScript(fixturePath, { PACKAGE_MANAGER: "pnpm" }, mockBinDir);

        expect(stdout).toContain("Detected lint/format scripts: format, lint");
        expect(stdout).toContain("Executing: pnpm run format");
        expect(stdout).toContain("Executing: pnpm run lint");
      } finally {
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });

    it("should run format and lint scripts using bun for lint-format/bun/basic fixture", () => {
      const mockBinDir = createMockBinDir();
      try {
        const fixturePath = path.join(fixturesDir, "lint-format/bun/basic");
        const stdout = runLintFormatScript(fixturePath, { PACKAGE_MANAGER: "bun" }, mockBinDir);

        expect(stdout).toContain("Detected lint/format scripts: format, lint");
        expect(stdout).toContain("Executing: bun run format");
        expect(stdout).toContain("Executing: bun run lint");
      } finally {
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });
  });

  describe("script execution routing", () => {
    const tempTestDir = path.resolve(process.cwd(), "node_modules/.tmp_lint_format_test");

    it("should skip and log when package.json does not exist", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      try {
        const stdout = runLintFormatScript(tempTestDir);
        expect(stdout).toContain("No package.json found. Skipping scripts.");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });

    it("should prioritize and run 'check' script if present", () => {
      const mockBinDir = createMockBinDir();
      fs.mkdirSync(tempTestDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempTestDir, "package.json"),
        JSON.stringify({
          scripts: {
            check: "echo check_ok",
            format: "echo format_ok",
            lint: "echo lint_ok",
          },
        }),
      );
      try {
        const stdout = runLintFormatScript(tempTestDir, { PACKAGE_MANAGER: "npm" }, mockBinDir);
        expect(stdout).toContain("Detected and executed script: check");
        expect(stdout).toContain("Executing: npm run check");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });

    it("should run both 'fmt' and 'lint' if 'format' is missing but 'fmt' is defined", () => {
      const mockBinDir = createMockBinDir();
      fs.mkdirSync(tempTestDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempTestDir, "package.json"),
        JSON.stringify({
          scripts: {
            fmt: "echo fmt_ok",
            lint: "echo lint_ok",
          },
        }),
      );
      try {
        const stdout = runLintFormatScript(tempTestDir, { PACKAGE_MANAGER: "npm" }, mockBinDir);
        expect(stdout).toContain("Detected lint/format scripts: fmt, lint");
        expect(stdout).toContain("Executing: npm run fmt");
        expect(stdout).toContain("Executing: npm run lint");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });

    it("should execute only 'lint' if format/fmt are not defined", () => {
      const mockBinDir = createMockBinDir();
      fs.mkdirSync(tempTestDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempTestDir, "package.json"),
        JSON.stringify({
          scripts: {
            lint: "echo lint_ok",
          },
        }),
      );
      try {
        const stdout = runLintFormatScript(tempTestDir, { PACKAGE_MANAGER: "npm" }, mockBinDir);
        expect(stdout).toContain("Executing: npm run lint");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
        fs.rmSync(mockBinDir, { recursive: true, force: true });
      }
    });

    it("should log info when no matching script exists in package.json", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempTestDir, "package.json"),
        JSON.stringify({
          scripts: {
            foo: "echo foo",
          },
        }),
      );
      try {
        const stdout = runLintFormatScript(tempTestDir);
        expect(stdout).toContain("No matching scripts (check, format, lint, etc.) found in package.json.");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });
  });
});
