import * as core from "@actions/core";
import fs from "node:fs";

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

export function setSiteVariables(): void {
  const actionPath = process.env.GITHUB_ACTION_PATH || "";
  const actionName = actionPath.split("/").pop() || "";
  const repoFull = process.env.GITHUB_REPOSITORY || "";
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "";
  const repo = repoFull.split("/")[1] || "";

  if (!owner || !repo) {
    core.warning("GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.");
    return;
  }

  const site = `https://${owner}.github.io`;
  const isPrimary = repo === `${owner}.github.io`;
  const base = isPrimary ? "/" : `/${repo}/`;
  const siteWithRepo = isPrimary ? site : `${site}/${repo}`;

  if (actionName === "astro") {
    core.exportVariable("SITE", site);
    core.exportVariable("BASE", base);
    core.info(`Set SITE=${site}`);
    core.info(`Set BASE=${base}`);
  }

  if (actionName === "vite" || actionName === "vite-plus") {
    core.exportVariable("VITE_SITE_URL", siteWithRepo);
    core.info(`Set VITE_SITE_URL=${siteWithRepo}`);
  }
}

export function writeOutput(nodeVersion: string, pm: PackageManager): void {
  core.setOutput("node-version", nodeVersion);
  core.setOutput("package-manager", pm.name);
  core.setOutput("package-manager-version", pm.version);
}

export function run(): void {
  const nodeVersion = detectNodeVersion();
  const pm = detectPackageManager();
  writeOutput(nodeVersion, pm);
  setSiteVariables();
}

if (process.env.NODE_ENV !== "test") {
  run();
}
