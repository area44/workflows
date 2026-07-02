import fs from "node:fs";
import { bench, describe, vi } from "vitest";

import { run } from "../src/run-scripts";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("@actions/core");

describe("run-scripts benchmarks", () => {
  bench("run - no package.json", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    run();
  });

  bench("run - check script exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { check: "echo check" } }),
    );
    // Mock execSync to not actually do anything
    run();
  });
});
