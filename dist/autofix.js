const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Runs common lint/format scripts if they exist in package.json.
 * Usage: node autofix.js [package_manager]
 */

function runAutofix() {
  if (!fs.existsSync('package.json')) {
    console.log('No package.json found. Skipping autofix scripts.');
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  } catch (err) {
    console.error(`Error: Failed to parse package.json: ${err.message}`);
    process.exit(1);
  }

  const scripts = pkg.scripts || {};
  const packageManager = process.argv[2] || 'npm';

  // Priority list of script combinations to try
  const combinations = [
    ['check'],
    ['format', 'lint'],
    ['fmt', 'lint'],
    ['lint'],
    ['format'],
    ['fmt'],
  ];

  let selectedScripts = [];
  for (const group of combinations) {
    if (group.every(name => scripts[name])) {
      selectedScripts = group;
      break;
    }
  }

  if (selectedScripts.length > 0) {
    console.log(`Detected autofix scripts: ${selectedScripts.join(', ')}`);
    for (const script of selectedScripts) {
      console.log(`Executing: ${packageManager} run ${script}`);
      try {
        execSync(`${packageManager} run ${script}`, { stdio: 'inherit' });
      } catch (err) {
        console.error(`Error: Script "${script}" failed with exit code ${err.status}`);
        process.exit(err.status || 1);
      }
    }
    console.log('Autofix scripts completed successfully.');
  } else {
    console.log('No matching autofix scripts (check, format, lint, etc.) found in package.json.');
  }
}

runAutofix();
