import * as core from "@actions/core";
import fs from "node:fs";

export interface PackageManager {
  name: string;
  version: string;
}

export interface DetectedEnv {
  nodeVersion: string;
  bunVersion: string;
  pm: PackageManager;
  runtime: "node" | "bun" | "both";
}

function hasNodeEngine(): boolean {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      return Boolean(pkg.engines?.node);
    }
  } catch {
    // Ignore detection errors
  }
  return false;
}

export function detectNodeVersion(pmName?: string, bunVersion?: string): string {
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
  if (pmName === "bun" && !bunVersion) {
    return "";
  }
  if (
    pmName === "bun" &&
    !hasNodeEngine() &&
    !fs.existsSync(".nvmrc") &&
    !fs.existsSync(".node-version")
  ) {
    return "";
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
        for (const pm of ["pnpm", "npm", "bun"]) {
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
    if (fs.existsSync("package-lock.json")) {
      core.info("Found package-lock.json, using npm@latest");
      return { name: "npm", version: "latest" };
    }
    if (fs.existsSync("bun.lock") || fs.existsSync("bun.lockb")) {
      core.info("Found bun lockfile, using bun@latest");
      return { name: "bun", version: "latest" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect package manager: ${message}`);
  }
  core.info("Package manager not specified, using npm@latest");
  return { name: "npm", version: "latest" };
}

export function detectBunVersion(pm: PackageManager): string {
  if (pm.name === "bun") {
    return pm.version;
  }
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.engines?.bun) {
        return pkg.engines.bun;
      }
    }
  } catch {
    // Ignore detection errors
  }
  return "";
}

export function parseRuntimeInput(runtimeInput: string): {
  specifiedRuntime?: "node" | "bun" | "both";
  nodeVersion?: string;
  bunVersion?: string;
} {
  if (!runtimeInput) return {};

  const trimmed = runtimeInput.trim().toLowerCase();
  if (trimmed === "both") {
    return { specifiedRuntime: "both" };
  }

  const parts = trimmed.split(/[\s,]+/);
  let specifiedRuntime: "node" | "bun" | "both" | undefined;
  let nodeVersion: string | undefined;
  let bunVersion: string | undefined;

  let hasNode = false;
  let hasBun = false;

  for (const part of parts) {
    if (part === "both") {
      hasNode = true;
      hasBun = true;
    } else if (part.startsWith("node")) {
      hasNode = true;
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        nodeVersion = part.slice(atIdx + 1);
      }
    } else if (part.startsWith("bun")) {
      hasBun = true;
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        bunVersion = part.slice(atIdx + 1);
      }
    }
  }

  if (hasNode && hasBun) {
    specifiedRuntime = "both";
  } else if (hasBun) {
    specifiedRuntime = "bun";
  } else if (hasNode) {
    specifiedRuntime = "node";
  }

  return { specifiedRuntime, nodeVersion, bunVersion };
}

export function detectRuntime(
  pm: PackageManager,
  bunVersion: string,
  _nodeVersion?: string,
): "node" | "bun" | "both" {
  const hasBun = pm.name === "bun" || Boolean(bunVersion);
  const hasNodeFile = fs.existsSync(".nvmrc") || fs.existsSync(".node-version") || hasNodeEngine();
  const hasNode = pm.name === "npm" || pm.name === "pnpm" || hasNodeFile;

  if (hasNode && hasBun) {
    return "both";
  }
  if (hasBun) {
    return "bun";
  }
  return "node";
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

  if (actionName === "astro" || actionName === "vite" || actionName === "vite-plus") {
    core.exportVariable("SITE", site);
    core.exportVariable("BASE", base);
    core.info(`Set SITE=${site}`);
    core.info(`Set BASE=${base}`);
  }
}

export function writeOutput(
  nodeVersion: string,
  pm: PackageManager,
  bunVersion: string = "",
  runtime: "bun" | "node" | "both" = "node",
): void {
  core.setOutput("node-version", nodeVersion);
  core.setOutput("bun-version", bunVersion);
  core.setOutput("package-manager", pm.name);
  core.setOutput("package-manager-version", pm.version);
  core.setOutput("runtime", runtime);
}

export function detectEnv(runtimeInput: string = core.getInput("runtime")): DetectedEnv {
  const parsed = parseRuntimeInput(runtimeInput);
  const pm = detectPackageManager();
  const detectedBunVer = detectBunVersion(pm);
  const detectedNodeVer = detectNodeVersion(pm.name, detectedBunVer);

  const bunVer =
    parsed.bunVersion ??
    (detectedBunVer ||
      (parsed.specifiedRuntime === "bun" || parsed.specifiedRuntime === "both" ? "latest" : ""));
  const nodeVer =
    parsed.nodeVersion ??
    (detectedNodeVer ||
      (parsed.specifiedRuntime === "node" || parsed.specifiedRuntime === "both" ? "lts/*" : ""));

  let runtime: "node" | "bun" | "both";
  if (parsed.specifiedRuntime) {
    runtime = parsed.specifiedRuntime;
  } else {
    runtime = detectRuntime(pm, detectedBunVer, detectedNodeVer);
  }

  const finalNodeVersion = runtime === "bun" && !parsed.nodeVersion ? "" : nodeVer;
  const finalBunVersion = runtime === "node" && !parsed.bunVersion ? "" : bunVer;

  return {
    nodeVersion: finalNodeVersion,
    bunVersion: finalBunVersion,
    pm,
    runtime,
  };
}

export function run(): void {
  const runtimeInput = core.getInput("runtime");
  const env = detectEnv(runtimeInput);
  writeOutput(env.nodeVersion, env.pm, env.bunVersion, env.runtime);
  setSiteVariables();
}

if (process.env.NODE_ENV !== "test") {
  run();
}
