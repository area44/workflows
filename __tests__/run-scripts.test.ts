import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { run } from "../src/run-scripts";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("@actions/core");

describe("run-scripts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PACKAGE_MANAGER = "npm";
  });

  it("should skip if package.json does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    run();
    expect(core.info).toHaveBeenCalledWith("No package.json found. Skipping lint/format scripts.");
  });

  it("should run 'check' script if it exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { check: "echo check" } }),
    );

    run();

    expect(core.info).toHaveBeenCalledWith("Executing: npm run check");
    expect(execSync).toHaveBeenCalledWith("npm run check", expect.any(Object));
  });

  it("should run 'format' and 'lint' if they both exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { format: "echo format", lint: "echo lint" } }),
    );

    run();

    expect(core.info).toHaveBeenCalledWith("Detected lint/format scripts: format, lint");
    expect(execSync).toHaveBeenCalledWith("npm run format", expect.any(Object));
    expect(execSync).toHaveBeenCalledWith("npm run lint", expect.any(Object));
  });

  it("should handle script failure", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ scripts: { check: "exit 1" } }));
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("failed");
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    run();

    expect(core.error).toHaveBeenCalledWith('Script "check" failed');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
