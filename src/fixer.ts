import * as core from "@actions/core";
import { execSync } from "child_process";
import fs from "fs";

/**
 * Runs common lint/format scripts if they exist in package.json.
 * Usage: node fixer.js [package_manager]
 */

const DEFAULT_ARG_INDEX = 2;

export function executeFixer(): void {
  if (!fs.existsSync("package.json")) {
    core.info("No package.json found. Skipping fixer scripts.");
    return;
  }

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch (error: any) {
    core.setFailed(`Failed to parse package.json: ${error.message}`);
    return;
  }

  const scripts = pkg.scripts || {};
  const packageManager =
    core.getInput("package-manager") || process.argv[DEFAULT_ARG_INDEX] || "npm";

  // Priority list of script combinations to try
  const combinations = [
    ["check"],
    ["format", "lint"],
    ["fmt", "lint"],
    ["lint"],
    ["format"],
    ["fmt"],
  ];

  let selectedScripts: string[] = [];
  for (const group of combinations) {
    if (group.every((name) => scripts[name])) {
      selectedScripts = group;
      break;
    }
  }

  if (selectedScripts.length > 0) {
    core.info(`Detected fixer scripts: ${selectedScripts.join(", ")}`);
    for (const script of selectedScripts) {
      core.info(`Executing: ${packageManager} run ${script}`);
      try {
        execSync(`${packageManager} run ${script}`, { stdio: "inherit" });
      } catch (error: any) {
        core.setFailed(`Script "${script}" failed with exit code ${error.status}`);
        return;
      }
    }
    core.info("Fixer scripts completed successfully.");
  } else {
    core.info("No matching fixer scripts (check, format, lint, etc.) found in package.json.");
  }
}

executeFixer();
