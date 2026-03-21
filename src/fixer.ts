import fs from "fs";
import { execSync } from "child_process";
import * as core from "@actions/core";

/**
 * Runs common lint/format scripts if they exist in package.json.
 * Usage: node fixer.js [package_manager]
 */

const DEFAULT_PACKAGE_MANAGER = "npm";
const MIN_SELECTED_SCRIPTS_LENGTH = 0;
const MAX_FUNCTION_LINES = 50;

const combinations = [
  ["check"],
  ["format", "lint"],
  ["fmt", "lint"],
  ["lint"],
  ["format"],
  ["fmt"],
];

const getSelectedScripts = (scripts: Record<string, string>): string[] => {
  for (const group of combinations) {
    if (group.every((name) => scripts[name])) {
      return group;
    }
  }
  return [];
};

export const executeFixer = (): void => {
  if (!fs.existsSync("package.json")) {
    core.info("No package.json found. Skipping fixer scripts.");
    return;
  }

  let pkg: any = {};
  try {
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch (error: any) {
    core.setFailed(`Failed to parse package.json: ${error.message}`);
    return;
  }

  const scripts = pkg.scripts || {};
  const packageManager =
    core.getInput("package-manager") || process.argv[2] || DEFAULT_PACKAGE_MANAGER;

  const selectedScripts = getSelectedScripts(scripts);

  if (selectedScripts.length > MIN_SELECTED_SCRIPTS_LENGTH) {
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
};

executeFixer();
