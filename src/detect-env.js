const fs = require('fs');
const path = require('path');

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

function detect() {
  let node_version = 'lts/*';
  let package_manager = 'npm';
  let package_manager_version = 'latest';

  // 1. Detect Node.js version
  try {
    if (fs.existsSync('.nvmrc')) {
      node_version = fs.readFileSync('.nvmrc', 'utf8').trim();
      console.log(`Found .nvmrc: ${node_version}`);
    } else if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.engines && pkg.engines.node) {
        node_version = pkg.engines.node;
        console.log(`Found Node.js version in package.json engines: ${node_version}`);
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to detect Node.js version: ${err.message}`);
  }

  // 2. Detect Package Manager
  try {
    if (fs.existsSync('pnpm-lock.yaml')) {
      package_manager = 'pnpm';
    } else if (fs.existsSync('yarn.lock')) {
      package_manager = 'yarn';
    } else if (fs.existsSync('package-lock.json')) {
      package_manager = 'npm';
    } else if (fs.existsSync('bun.lockb') || fs.existsSync('bun.lock')) {
      package_manager = 'bun';
    } else if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split('@');
        package_manager = name;
        package_manager_version = version || 'latest';
        console.log(`Found packageManager in package.json: ${package_manager}@${package_manager_version}`);
      }
    }
  } catch (err) {
    console.error(`Warning: Failed to detect package manager: ${err.message}`);
  }

  const output = [
    `node_version=${node_version}`,
    `package_manager=${package_manager}`,
    `package_manager_version=${package_manager_version}`
  ].join('\n');

  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
    } catch (err) {
      console.error(`Error: Failed to write to GITHUB_OUTPUT: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('GITHUB_OUTPUT not set. Detected values:');
    console.log(output);
  }

  console.log(`Final detection - Node: ${node_version}, PM: ${package_manager}@${package_manager_version}`);
}

detect();
