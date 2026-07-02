import fs from "node:fs";
import { bench, describe, vi } from "vitest";

import { detectNodeVersion, detectPackageManager, setSiteVariables } from "../src/detect-env";

vi.mock("node:fs");
vi.mock("@actions/core");

describe("detect-env benchmarks", () => {
  describe("detectNodeVersion", () => {
    bench("detectNodeVersion - no files", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      detectNodeVersion();
    });

    bench("detectNodeVersion - .nvmrc", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === ".nvmrc");
      vi.mocked(fs.readFileSync).mockReturnValue("20");
      detectNodeVersion();
    });
  });

  describe("detectPackageManager", () => {
    bench("detectPackageManager - no files", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      detectPackageManager();
    });

    bench("detectPackageManager - pnpm-lock.yaml", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => path === "pnpm-lock.yaml");
      detectPackageManager();
    });
  });

  describe("setSiteVariables", () => {
    bench("setSiteVariables", () => {
      process.env.GITHUB_ACTION_PATH = "/home/runner/work/_actions/owner/repo/v1/astro";
      process.env.GITHUB_REPOSITORY = "user/repo";
      process.env.GITHUB_REPOSITORY_OWNER = "user";
      setSiteVariables();
    });
  });
});
