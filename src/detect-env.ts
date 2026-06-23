import * as core from "@actions/core";
import fs from "node:fs";

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

export interface PackageManager {
  name: string;
  version: string;
}

export function detectNodeVersion(): string {
  try {
    if (fs.existsSync(".nvmrc")) {
      const version = fs.readFileSync(".nvmrc", "utf8").trim();
      core.info(`Found .nvmrc: ${version}`);
      return version;
    }
    if (fs.existsSync(".node-version")) {
      const version = fs.readFileSync(".node-version", "utf8").trim();
      core.info(`Found .node-version: ${version}`);
      return version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.engines?.node) {
        core.info(`Found Node.js version in package.json engines: ${pkg.engines.node}`);
        return pkg.engines.node;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect Node.js version: ${message}`);
  }
  core.info("Node.js version not specified, using lts/*");
  return "lts/*";
}

export function detectPackageManager(): PackageManager {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.packageManager) {
        const [name, version = "latest"] = pkg.packageManager.split("@");
        core.info(`Found packageManager in package.json: ${name}@${version}`);
        return { name, version };
      }

      if (pkg.engines) {
        for (const pm of ["pnpm", "yarn", "npm", "bun"]) {
          if (pkg.engines[pm]) {
            core.info(`Found ${pm} in package.json engines: ${pkg.engines[pm]}`);
            return { name: pm, version: pkg.engines[pm] };
          }
        }
      }
    }

    if (fs.existsSync("pnpm-lock.yaml")) {
      core.info("Found pnpm-lock.yaml, using pnpm@latest");
      return { name: "pnpm", version: "latest" };
    }
    if (fs.existsSync("yarn.lock")) {
      core.info("Found yarn.lock, using yarn@latest");
      return { name: "yarn", version: "latest" };
    }
    if (fs.existsSync("package-lock.json")) {
      core.info("Found package-lock.json, using npm@latest");
      return { name: "npm", version: "latest" };
    }
    if (fs.existsSync("bun.lock")) {
      core.info("Found bun.lock, using bun@latest");
      return { name: "bun", version: "latest" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect package manager: ${message}`);
  }
  core.info("Package manager not specified, using npm@latest");
  return { name: "npm", version: "latest" };
}

export function writeOutput(nodeVersion: string, pm: PackageManager): void {
  core.setOutput("node_version", nodeVersion);
  core.setOutput("package_manager", pm.name);
  core.setOutput("package_manager_version", pm.version);
}

export function run(): void {
  const nodeVersion = detectNodeVersion();
  const pm = detectPackageManager();
  writeOutput(nodeVersion, pm);
}

if (process.env.NODE_ENV !== "test") {
  run();
}
