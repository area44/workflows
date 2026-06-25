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

function runCommand(pm: string, name: string, cwd: string): boolean {
  core.info(`Executing: ${pm} run ${name} in ${cwd}`);
  try {
    execSync(`${pm} run ${name}`, { stdio: "inherit", cwd });
    return true;
  } catch {
    core.error(`Script "${name}" failed`);
    process.exit(1);
  }
}

function executeScripts(scripts: Record<string, string>, pm: string, cwd: string): void {
  const runner = (name: string) => (scripts[name] ? runCommand(pm, name, cwd) : false);

  if (runner("test")) {
    core.info("Detected and executed test script: test");
  } else if (runner("check")) {
    core.info("Detected and executed script: check");
  } else if (scripts.format && scripts.lint) {
    core.info("Detected lint/format scripts: format, lint");
    runner("format");
    runner("lint");
  } else if (scripts.fmt && scripts.lint) {
    core.info("Detected lint/format scripts: fmt, lint");
    runner("fmt");
    runner("lint");
  } else if (runner("lint") || runner("format") || runner("fmt")) {
    // Already executed via runner call
  } else {
    core.info("No matching scripts (test, check, format, lint, etc.) found in package.json.");
  }
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

    executeScripts(scripts, pm, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run();
}
