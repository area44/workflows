import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const scriptPath = path.resolve(process.cwd(), "src/site-variables.sh");

function parseEnv(envStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envStr.trim().split("\n")) {
    if (!line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    result[key.trim()] = rest.join("=").trim();
  }
  return result;
}

function runSiteVariables(envOverrides: Record<string, string> = {}) {
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), "tmp_site_var_test_"));
  const envFile = path.join(tmpDir, "github_env");

  try {
    const env: Record<string, string> = { ...process.env, GITHUB_ENV: envFile };
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v === undefined) {
        delete env[k];
      } else {
        env[k] = v;
      }
    }

    const stdout = execFileSync("bash", [scriptPath], {
      env,
      encoding: "utf8",
    });

    let envFileContent = "";
    if (fs.existsSync(envFile)) {
      envFileContent = fs.readFileSync(envFile, "utf8");
    }

    return { stdout, envVars: parseEnv(envFileContent) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("site-variables shell script", () => {
  it("should set SITE and BASE variables for a standard repository in the astro action", () => {
    const { stdout, envVars } = runSiteVariables({
      GITHUB_ACTION_PATH: "/home/runner/work/_actions/owner/repo/v1/astro",
      GITHUB_REPOSITORY: "owner/project-repo",
      GITHUB_REPOSITORY_OWNER: "owner",
    });

    expect(envVars["SITE"]).toBe("https://owner.github.io");
    expect(envVars["BASE"]).toBe("/project-repo/");
    expect(stdout).toContain("Set SITE=https://owner.github.io");
    expect(stdout).toContain("Set BASE=/project-repo/");
  });

  it("should set SITE and BASE variables for a primary repository in the vite action", () => {
    const { envVars } = runSiteVariables({
      GITHUB_ACTION_PATH: "/home/runner/work/_actions/owner/repo/v1/vite",
      GITHUB_REPOSITORY: "owner/owner.github.io",
      GITHUB_REPOSITORY_OWNER: "owner",
    });

    expect(envVars["SITE"]).toBe("https://owner.github.io");
    expect(envVars["BASE"]).toBe("/");
  });

  it("should set SITE and BASE variables for the vite-plus action", () => {
    const { envVars } = runSiteVariables({
      GITHUB_ACTION_PATH: "/home/runner/work/_actions/owner/repo/v1/vite-plus",
      GITHUB_REPOSITORY: "owner/some-other-project",
      GITHUB_REPOSITORY_OWNER: "owner",
    });

    expect(envVars["SITE"]).toBe("https://owner.github.io");
    expect(envVars["BASE"]).toBe("/some-other-project/");
  });

  it("should not set SITE and BASE variables for action paths not matching astro/vite/vite-plus", () => {
    const { envVars } = runSiteVariables({
      GITHUB_ACTION_PATH: "/home/runner/work/_actions/owner/repo/v1/lint-format",
      GITHUB_REPOSITORY: "owner/project-repo",
      GITHUB_REPOSITORY_OWNER: "owner",
    });

    expect(envVars["SITE"]).toBeUndefined();
    expect(envVars["BASE"]).toBeUndefined();
  });

  it("should skip setting variables and print message if GITHUB_REPOSITORY is missing", () => {
    const { stdout, envVars } = runSiteVariables({
      GITHUB_ACTION_PATH: "/home/runner/work/_actions/owner/repo/v1/astro",
      GITHUB_REPOSITORY_OWNER: "owner",
      GITHUB_REPOSITORY: "",
    });

    expect(stdout).toContain("GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.");
    expect(envVars["SITE"]).toBeUndefined();
  });
});
