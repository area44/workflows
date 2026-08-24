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
  runtime: "node" | "bun";
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

function hasBunEngine(): boolean {
  try {
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      return Boolean(pkg.engines?.bun);
    }
  } catch {
    // Ignore detection errors
  }
  return false;
}

export function detectNodeVersion(pmName?: string): string {
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
  try {
    if (fs.existsSync(".bun-version")) {
      const version = fs.readFileSync(".bun-version", "utf8").trim();
      core.info(`Found .bun-version: ${version}`);
      return version;
    }
    if (pm.name === "bun" && pm.version && pm.version !== "latest") {
      return pm.version;
    }
    if (fs.existsSync("package.json")) {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      if (pkg.engines?.bun) {
        core.info(`Found Bun version in package.json engines: ${pkg.engines.bun}`);
        return pkg.engines.bun;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to detect Bun version: ${message}`);
  }

  const isBunDetected =
    pm.name === "bun" || fs.existsSync("bun.lock") || fs.existsSync("bun.lockb") || hasBunEngine();

  if (isBunDetected) {
    return "latest";
  }

  return "";
}

export function parseRuntimeInput(runtimeInput: string): {
  specifiedRuntime?: "node" | "bun";
  nodeVersion?: string;
  bunVersion?: string;
} {
  if (!runtimeInput) return {};

  const trimmed = runtimeInput.trim().toLowerCase();
  const parts = trimmed.split(/[\s,]+/);
  let specifiedRuntime: "node" | "bun" | undefined;
  let nodeVersion: string | undefined;
  let bunVersion: string | undefined;

  let hasBun = false;

  for (const part of parts) {
    if (part === "both") {
      hasBun = true;
    } else if (part.startsWith("node")) {
      if (!specifiedRuntime) specifiedRuntime = "node";
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        nodeVersion = part.slice(atIdx + 1);
      }
    } else if (part.startsWith("bun")) {
      hasBun = true;
      if (!specifiedRuntime) specifiedRuntime = "bun";
      const atIdx = part.indexOf("@");
      if (atIdx !== -1) {
        bunVersion = part.slice(atIdx + 1);
      }
    }
  }

  return {
    specifiedRuntime,
    nodeVersion,
    bunVersion: bunVersion || (hasBun ? "latest" : undefined),
  };
}

export function detectRuntime(pm: PackageManager, bunVersion: string): "node" | "bun" {
  if (pm.name === "bun" || Boolean(bunVersion)) {
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
  runtime: "bun" | "node" = "node",
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

  let runtime: "node" | "bun";
  if (parsed.specifiedRuntime) {
    runtime = parsed.specifiedRuntime;
  } else if (pm.name === "bun") {
    runtime = "bun";
  } else {
    runtime = "node";
  }

  const detectedNodeVer = detectNodeVersion(runtime === "bun" ? "bun" : pm.name);

  const bunVer = parsed.bunVersion ?? detectedBunVer;
  const nodeVer =
    parsed.nodeVersion ?? (runtime === "bun" && !parsed.nodeVersion ? "" : detectedNodeVer);

  return {
    nodeVersion: nodeVer,
    bunVersion: bunVer,
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
