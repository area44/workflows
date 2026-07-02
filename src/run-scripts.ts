import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";

interface PackageJson {
  scripts?: Record<string, string>;
}

function runCommand(pm: string, name: string): boolean {
  core.info(`Executing: ${pm} run ${name}`);
  try {
    execSync(`${pm} run ${name}`, { stdio: "inherit" });
    return true;
  } catch {
    core.error(`Script "${name}" failed`);
    process.exit(1);
  }
}

function executeScripts(scripts: Record<string, string>, pm: string): void {
  const runner = (name: string) => (scripts[name] ? runCommand(pm, name) : false);

  if (runner("check")) {
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
    core.info("No matching scripts (check, format, lint, etc.) found in package.json.");
  }
}

export function run(): void {
  try {
    if (!fs.existsSync("package.json")) {
      core.info("No package.json found. Skipping scripts.");
      return;
    }

    const pkg: PackageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const scripts = pkg.scripts || {};
    const pm = process.env.PACKAGE_MANAGER || "npm";

    executeScripts(scripts, pm);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run();
}
