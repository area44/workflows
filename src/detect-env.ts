import fs from 'fs';

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

export function detectNodeVersion(): string {
  try {
    if (fs.existsSync('.nvmrc')) {
      const version = fs.readFileSync('.nvmrc', 'utf8').trim();
      console.log(`Found .nvmrc: ${version}`);
      return version;
    }
    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.engines && pkg.engines.node) {
        console.log(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
        return pkg.engines.node;
      }
    }
  } catch (err: any) {
    console.error(`Warning: Failed to detect Node.js version: ${err.message}`);
  }
  return 'lts/*';
}

export interface PackageManager {
  name: string;
  version: string;
}

export function detectPackageManager(): PackageManager {
  try {
    if (fs.existsSync('pnpm-lock.yaml')) return { name: 'pnpm', version: 'latest' };
    if (fs.existsSync('yarn.lock')) return { name: 'yarn', version: 'latest' };
    if (fs.existsSync('package-lock.json')) return { name: 'npm', version: 'latest' };
    if (fs.existsSync('bun.lockb') || fs.existsSync('bun.lock')) return { name: 'bun', version: 'latest' };

    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split('@');
        console.log(`Found packageManager in package.json: ${name}@${version || 'latest'}`);
        return { name, version: version || 'latest' };
      }
    }
  } catch (err: any) {
    console.error(`Warning: Failed to detect package manager: ${err.message}`);
  }
  return { name: 'npm', version: 'latest' };
}

export function writeOutput(nodeVersion: string, pm: PackageManager): void {
  const output = [
    `node_version=${nodeVersion}`,
    `package_manager=${pm.name}`,
    `package_manager_version=${pm.version}`
  ].join('\n');

  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
    } catch (err: any) {
      console.error(`Error: Failed to write to GITHUB_OUTPUT: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('GITHUB_OUTPUT not set. Detected values:');
    console.log(output);
  }
}

export function run(): void {
  const nodeVersion = detectNodeVersion();
  const pm = detectPackageManager();
  writeOutput(nodeVersion, pm);
  console.log(`Final detection - Node: ${nodeVersion}, PM: ${pm.name}@${pm.version}`);
}

if (require.main === module) {
  run();
}
