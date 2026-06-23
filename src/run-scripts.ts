import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";

/**
 * Detects and runs lint/format scripts from package.json.
 */

interface PackageJson {
  scripts?: Record<string, string>;
}

export function run(): void {
  try {
    if (!fs.existsSync("package.json")) {
      core.info("No package.json found. Skipping lint/format scripts.");
      return;
    }

    const pkg: PackageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const scripts = pkg.scripts || {};
    const pm = process.env.PACKAGE_MANAGER || "npm";

    const runScript = (name: string): boolean => {
      if (scripts[name]) {
        core.info(`Executing: ${pm} run ${name}`);
        try {
          execSync(`${pm} run ${name}`, { stdio: "inherit" });
          return true;
        } catch {
          core.error(`Script "${name}" failed`);
          process.exit(1);
        }
      }
      return false;
    };

    if (runScript("check")) {
      core.info("Detected and executed lint/format script: check");
    } else if (scripts.format && scripts.lint) {
      core.info("Detected lint/format scripts: format, lint");
      runScript("format");
      runScript("lint");
    } else if (scripts.fmt && scripts.lint) {
      core.info("Detected lint/format scripts: fmt, lint");
      runScript("fmt");
      runScript("lint");
    } else if (runScript("lint")) {
      core.info("Detected and executed lint/format script: lint");
    } else if (runScript("format")) {
      core.info("Detected and executed lint/format script: format");
    } else if (runScript("fmt")) {
      core.info("Detected and executed lint/format script: fmt");
    } else {
      core.info(
        "No matching lint/format scripts (check, format, lint, etc.) found in package.json.",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run();
}
