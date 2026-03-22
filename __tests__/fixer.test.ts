import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "child_process";
import { executeFixer } from "../src/fixer";
import fs from "fs";

vi.mock("fs");
vi.mock("child_process");
vi.mock("@actions/core");

describe("fixer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ["node", "fixer.js"];
  });

  it("should skip if package.json does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    executeFixer();

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining("No package.json found"));
  });

  it('should run "check" script if it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        scripts: { check: "tsc" },
      }),
    );

    executeFixer();

    expect(execSync).toHaveBeenCalledWith("npm run check", expect.any(Object));
  });

  it('should run "format" and "lint" scripts if they exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        scripts: { format: "prettier", lint: "eslint" },
      }),
    );

    executeFixer();

    expect(execSync).toHaveBeenCalledWith("npm run format", expect.any(Object));
    expect(execSync).toHaveBeenCalledWith("npm run lint", expect.any(Object));
  });

  it("should use specified package manager from arguments", () => {
    process.argv = ["node", "fixer.js", "pnpm"];
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        scripts: { check: "tsc" },
      }),
    );

    executeFixer();

    expect(execSync).toHaveBeenCalledWith("pnpm run check", expect.any(Object));
  });
});
