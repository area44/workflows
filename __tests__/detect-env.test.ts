import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const scriptPath = path.resolve(process.cwd(), "src/detect-env.sh");
const fixturesDir = path.resolve(process.cwd(), "__tests__/fixtures");

function parseOutputs(outputStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of outputStr.trim().split("\n")) {
    if (!line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    result[key.trim()] = rest.join("=").trim();
  }
  return result;
}

function runDetectEnv(cwd: string, runtimeInput = "", envOverrides: Record<string, string> = {}) {
  const tmpDir = fs.mkdtempSync(path.join(cwd, "tmp_test_"));
  const outputFile = path.join(tmpDir, "github_output");

  try {
    const stdout = execFileSync("bash", [scriptPath, runtimeInput], {
      cwd,
      env: { ...process.env, GITHUB_OUTPUT: outputFile, ...envOverrides },
      encoding: "utf8",
    });

    let outputFileContent = "";
    if (fs.existsSync(outputFile)) {
      outputFileContent = fs.readFileSync(outputFile, "utf8");
    }

    return { stdout, outputs: parseOutputs(outputFileContent.length > 0 ? outputFileContent : stdout) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("detect-env shell script", () => {
  describe("Runtime Input Parsing", () => {
    const tempTestDir = path.resolve(process.cwd(), "node_modules/.tmp_detect_env_test");

    it("should respect explicit runtime input node@22", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      try {
        const { outputs } = runDetectEnv(tempTestDir, "node@22");
        expect(outputs["runtime"]).toBe("node");
        expect(outputs["node-version"]).toBe("22");
        expect(outputs["bun-version"]).toBe("");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });

    it("should respect explicit runtime input bun@1.4", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      try {
        const { outputs } = runDetectEnv(tempTestDir, "bun@1.4");
        expect(outputs["runtime"]).toBe("bun");
        expect(outputs["node-version"]).toBe("");
        expect(outputs["bun-version"]).toBe("1.4");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });

    it("should respect explicit runtime input node@22,bun@1.4", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      try {
        const { outputs } = runDetectEnv(tempTestDir, "node@22,bun@1.4");
        expect(outputs["runtime"]).toBe("node");
        expect(outputs["node-version"]).toBe("22");
        expect(outputs["bun-version"]).toBe("1.4");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });

    it("should parse both keyword", () => {
      fs.mkdirSync(tempTestDir, { recursive: true });
      try {
        const { outputs } = runDetectEnv(tempTestDir, "both");
        expect(outputs["bun-version"]).toBe("latest");
      } finally {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    });
  });

  describe("Fixture-based tests", () => {
    const cases = [
      {
        action: "astro",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPmName: "npm",
        expectedPmVer: "11.19.0",
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "npm",
        type: "minimal",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPmName: "npm",
        expectedPmVer: "latest",
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPmName: "pnpm",
        expectedPmVer: "11.21.0",
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "pnpm",
        type: "minimal",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPmName: "pnpm",
        expectedPmVer: "latest",
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "bun",
        type: "basic",
        expectedNode: "",
        expectedBun: "latest",
        expectedPmName: "bun",
        expectedPmVer: "latest",
        expectedRuntime: "bun",
      },
      {
        action: "astro",
        pm: "bun/pnpm-bun",
        type: "",
        expectedNode: "lts/*",
        expectedBun: ">=1.0.0",
        expectedPmName: "pnpm",
        expectedPmVer: "11.21.0",
        expectedRuntime: "node",
      },
      {
        action: "astro",
        pm: "bun",
        type: "minimal",
        expectedNode: "",
        expectedBun: "latest",
        expectedPmName: "bun",
        expectedPmVer: "latest",
        expectedRuntime: "bun",
      },
      {
        action: "lint-format",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPmName: "npm",
        expectedPmVer: "11.19.0",
        expectedRuntime: "node",
      },
      {
        action: "lint-format",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPmName: "pnpm",
        expectedPmVer: "11.21.0",
        expectedRuntime: "node",
      },
      {
        action: "vite",
        pm: "npm",
        type: "basic",
        expectedNode: "24.19.0",
        expectedBun: "",
        expectedPmName: "npm",
        expectedPmVer: "11.19.0",
        expectedRuntime: "node",
      },
      {
        action: "vite-plus",
        pm: "pnpm",
        type: "basic",
        expectedNode: "lts/*",
        expectedBun: "",
        expectedPmName: "pnpm",
        expectedPmVer: "11.21.0",
        expectedRuntime: "node",
      },
    ];

    it.each(cases)(
      "should detect correct environment for fixture $action/$pm/$type",
      ({ action, pm, type, expectedNode, expectedBun, expectedPmName, expectedPmVer, expectedRuntime }) => {
        const fixturePath = type ? path.join(fixturesDir, action, pm, type) : path.join(fixturesDir, action, pm);
        const { outputs } = runDetectEnv(fixturePath);

        expect(outputs["node-version"]).toBe(expectedNode);
        expect(outputs["bun-version"]).toBe(expectedBun);
        expect(outputs["package-manager"]).toBe(expectedPmName);
        expect(outputs["package-manager-version"]).toBe(expectedPmVer);
        expect(outputs["runtime"]).toBe(expectedRuntime);
      },
    );
  });
});
