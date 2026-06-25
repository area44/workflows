import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";

/**
 * Detects Node.js version and package manager from the environment.
 * Outputs the results to GITHUB_OUTPUT.
 */

export interface PackageManager {
  name: string;
  version: string;
}

export function detectNodeVersion(cwd: string): string {
  try {
    const nvmrcPath = path.join(cwd, ".nvmrc");
    if (fs.existsSync(nvmrcPath)) {
      const version = fs.readFileSync(nvmrcPath, "utf8").trim();
      core.info(`Found .nvmrc: ${version}`);
      return version;
    }
    const nodeVersionPath = path.join(cwd, ".node-version");
    if (fs.existsSync(nodeVersionPath)) {
      const version = fs.readFileSync(nodeVersionPath, "utf8").trim();
      core.info(`Found .node-version: ${version}`);
      return version;
    }
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
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

export function detectPackageManager(cwd: string): PackageManager {
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
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

    if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
      core.info("Found pnpm-lock.yaml, using pnpm@latest");
      return { name: "pnpm", version: "latest" };
    }
    if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
      core.info("Found yarn.lock, using yarn@latest");
      return { name: "yarn", version: "latest" };
    }
    if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
      core.info("Found package-lock.json, using npm@latest");
      return { name: "npm", version: "latest" };
    }
    if (fs.existsSync(path.join(cwd, "bun.lock"))) {
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
  core.setOutput("node-version", nodeVersion);
  core.setOutput("package-manager", pm.name);
  core.setOutput("package-manager-version", pm.version);
}

export function run(): void {
  const cwd = process.argv[2] || process.cwd();
  core.info(`Detecting environment in: ${cwd}`);
  const nodeVersion = detectNodeVersion(cwd);
  const pm = detectPackageManager(cwd);
  writeOutput(nodeVersion, pm);
}

if (process.env.NODE_ENV !== "test") {
  run();
}
