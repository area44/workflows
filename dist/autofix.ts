import fs from 'fs';
import { execSync } from 'child_process';
import * as core from '@actions/core';

/**
 * Runs common lint/format scripts if they exist in package.json.
 * Usage: node autofix.js [package_manager]
 */

export function runAutofix(): void {
  if (!fs.existsSync('package.json')) {
    core.info('No package.json found. Skipping autofix scripts.');
    return;
  }

  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  } catch (err: any) {
    core.setFailed(`Failed to parse package.json: ${err.message}`);
    return;
  }

  const scripts = pkg.scripts || {};
  const packageManager = core.getInput('package-manager') || process.argv[2] || 'npm';

  // Priority list of script combinations to try
  const combinations = [
    ['check'],
    ['format', 'lint'],
    ['fmt', 'lint'],
    ['lint'],
    ['format'],
    ['fmt'],
  ];

  let selectedScripts: string[] = [];
  for (const group of combinations) {
    if (group.every(name => scripts[name])) {
      selectedScripts = group;
      break;
    }
  }

  if (selectedScripts.length > 0) {
    core.info(`Detected autofix scripts: ${selectedScripts.join(', ')}`);
    for (const script of selectedScripts) {
      core.info(`Executing: ${packageManager} run ${script}`);
      try {
        execSync(`${packageManager} run ${script}`, { stdio: 'inherit' });
      } catch (err: any) {
        core.setFailed(`Script "${script}" failed with exit code ${err.status}`);
        return;
      }
    }
    core.info('Autofix scripts completed successfully.');
  } else {
    core.info('No matching autofix scripts (check, format, lint, etc.) found in package.json.');
  }
}
