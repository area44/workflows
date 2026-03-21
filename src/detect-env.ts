import * as core from "@actions/core";
import fs from "fs";

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

export function detectNodeVersion(): string {
  try {
    if (fs.existsSync(".nvmrc")) {
      const version = fs.readFileSync(".nvmrc", "utf8").trim();
      core.info(`Found .nvmrc: ${version}`);
      return version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.engines && pkg.engines.node) {
        core.info(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
        return pkg.engines.node;
      }
    }
  } catch (error: any) {
    core.warning(`Failed to detect Node.js version: ${error.message}`);
  }
  return "lts/*";
}

export interface PackageManager {
  name: string;
  version: string;
}

export function detectPackageManager(): PackageManager {
  try {
    if (fs.existsSync("pnpm-lock.yaml")) {
      return { name: "pnpm", version: "latest" };
    }
    if (fs.existsSync("yarn.lock")) {
      return { name: "yarn", version: "latest" };
    }
    if (fs.existsSync("package-lock.json")) {
      return { name: "npm", version: "latest" };
    }
    if (fs.existsSync("bun.lockb") || fs.existsSync("bun.lock")) {
      return { name: "bun", version: "latest" };
    }

    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.packageManager) {
        const [name, version] = pkg.packageManager.split("@");
        core.info(`Found packageManager in package.json: ${name}@${version || "latest"}`);
        return { name, version: version || "latest" };
      }
    }
  } catch (error: any) {
    core.warning(`Failed to detect package manager: ${error.message}`);
  }
  return { name: "npm", version: "latest" };
}

export function writeOutput(nodeVersion: string, pm: PackageManager): void {
  core.setOutput("node_version", nodeVersion);
  core.setOutput("package_manager", pm.name);
  core.setOutput("package_manager_version", pm.version);

  core.info(`Detected values:
node_version=${nodeVersion}
package_manager=${pm.name}
package_manager_version=${pm.version}`);
}

export function run(): void {
  const nodeVersion = detectNodeVersion();
  const pm = detectPackageManager();
  writeOutput(nodeVersion, pm);
  core.info(`Final detection - Node: ${nodeVersion}, PM: ${pm.name}@${pm.version}`);
}

run();
