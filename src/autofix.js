const fs = require('fs');
const { execSync } = require('child_process');

if (!fs.existsSync('package.json')) {
  console.log('No package.json found.');
  process.exit(0);
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch (e) {
  console.error('Failed to parse package.json');
  process.exit(1);
}

const scripts = pkg.scripts || {};
const packageManager = process.argv[2] || 'npm';

const cases = [
  ['check'],
  ['format', 'lint'],
  ['fmt', 'lint'],
  ['lint'],
  ['format'],
  ['fmt'],
];

let selectedScripts = [];
for (const group of cases) {
  if (group.every(name => scripts[name])) {
    selectedScripts = group;
    break;
  }
}

if (selectedScripts.length > 0) {
  console.log('Running scripts: ' + selectedScripts.join(', '));
  for (const script of selectedScripts) {
    console.log(`Executing: ${packageManager} run ${script}`);
    try {
      execSync(`${packageManager} run ${script}`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Script ${script} failed`);
      process.exit(1);
    }
  }
} else {
  console.log('No matching scripts found.');
}
