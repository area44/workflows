import * as core from "@actions/core";
import fs from "fs";

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

const DEFAULT_NODE_VERSION = "lts/*";
const DEFAULT_PM_NAME = "npm";
const DEFAULT_PM_VERSION = "latest";

export const detectNodeVersion = (): string => {
  try {
    if (fs.existsSync(".nvmrc")) {
      const version = fs.readFileSync(".nvmrc", "utf8").trim();
      core.info(`Found .nvmrc: ${version}`);
      return version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.engines?.node) {
        core.info(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
        return pkg.engines.node;
      }
    }
  } catch (error: any) {
    core.warning(`Failed to detect Node.js version: ${error.message}`);
  }
  return DEFAULT_NODE_VERSION;
};

export interface PackageManager {
  name: string;
  version: string;
}

const detectFromLocks = (): PackageManager | null => {
  if (fs.existsSync("pnpm-lock.yaml")) {
    return { name: "pnpm", version: DEFAULT_PM_VERSION };
  }
  if (fs.existsSync("yarn.lock")) {
    return { name: "yarn", version: DEFAULT_PM_VERSION };
  }
  if (fs.existsSync("package-lock.json")) {
    return { name: "npm", version: DEFAULT_PM_VERSION };
  }
  if (fs.existsSync("bun.lockb") || fs.existsSync("bun.lock")) {
    return { name: "bun", version: DEFAULT_PM_VERSION };
  }
  return null;
};

export const detectPackageManager = (): PackageManager => {
  try {
    const fromLocks = detectFromLocks();
    if (fromLocks) {
      return fromLocks;
    }

    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split("@");
        core.info(`Found packageManager in package.json: ${name}@${version || DEFAULT_PM_VERSION}`);
        return { name, version: version || DEFAULT_PM_VERSION };
      }
    }
  } catch (error: any) {
    core.warning(`Failed to detect package manager: ${error.message}`);
  }
  return { name: DEFAULT_PM_NAME, version: DEFAULT_PM_VERSION };
};

export const writeOutput = (nodeVersion: string, packageManager: PackageManager): void => {
  core.setOutput("node_version", nodeVersion);
  core.setOutput("package_manager", packageManager.name);
  core.setOutput("package_manager_version", packageManager.version);

  core.info(`Detected values:
node_version=${nodeVersion}
package_manager=${packageManager.name}
package_manager_version=${packageManager.version}`);
};

export const run = (): void => {
  const nodeVersion = detectNodeVersion();
  const packageManager = detectPackageManager();
  writeOutput(nodeVersion, packageManager);
  core.info(
    `Final detection - Node: ${nodeVersion}, PM: ${packageManager.name}@${packageManager.version}`,
  );
};

run();
