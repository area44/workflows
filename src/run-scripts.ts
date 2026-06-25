import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Detects and runs scripts from package.json.
 */

interface PackageJson {
  scripts?: Record<string, string>;
}

export function run(): void {
  try {
    const cwd = process.argv[2] || process.cwd();
    const pkgPath = path.join(cwd, "package.json");

    if (!fs.existsSync(pkgPath)) {
      core.info(`No package.json found in ${cwd}. Skipping scripts.`);
      return;
    }

    const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    const pm = process.env.PACKAGE_MANAGER || "npm";

    const runScript = (name: string): boolean => {
      if (scripts[name]) {
        core.info(`Executing: ${pm} run ${name} in ${cwd}`);
        try {
          execSync(`${pm} run ${name}`, { stdio: "inherit", cwd });
          return true;
        } catch {
          core.error(`Script "${name}" failed`);
          process.exit(1);
        }
      }
      return false;
    };

    // Priority for testing
    if (runScript("test")) {
      core.info("Detected and executed test script: test");
    } else if (runScript("check")) {
      core.info("Detected and executed script: check");
    } else if (scripts.format && scripts.lint) {
      core.info("Detected lint/format scripts: format, lint");
      runScript("format");
      runScript("lint");
    } else if (scripts.fmt && scripts.lint) {
      core.info("Detected lint/format scripts: fmt, lint");
      runScript("fmt");
      runScript("lint");
    } else if (runScript("lint")) {
      core.info("Detected and executed script: lint");
    } else if (runScript("format")) {
      core.info("Detected and executed script: format");
    } else if (runScript("fmt")) {
      core.info("Detected and executed script: fmt");
    } else {
      core.info("No matching scripts (test, check, format, lint, etc.) found in package.json.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run();
}
