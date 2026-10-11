import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { detectJsLanguage, detectPythonLanguage } from "./resolve-environment.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

export function sanitizePackageManager(pm: string): string {
  const clean = pm.trim().toLowerCase();
  if (/^[a-z0-9_.-]+$/.test(clean)) {
    return clean;
  }
  return "npm";
}

function runCommand(pm: string, name: string): void {
  const safePm = sanitizePackageManager(pm);
  core.info(`Executing: ${safePm} run ${name}`);
  try {
    execSync(`${safePm} run ${name}`, { stdio: "inherit" });
  } catch {
    core.error(`Script "${name}" failed`);
    process.exit(1);
  }
}

function runRuffCommand(cmd: string): void {
  core.info(`Executing: ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    core.error(`Command "${cmd}" failed`);
    process.exit(1);
  }
}

function executeScripts(scripts: Record<string, string>, pm: string): void {
  if (scripts.check) {
    runCommand(pm, "check");
    core.info("Detected and executed script: check");
  } else if (scripts.format && scripts.lint) {
    core.info("Detected lint/format scripts: format, lint");
    runCommand(pm, "format");
    runCommand(pm, "lint");
  } else if (scripts.fmt && scripts.lint) {
    core.info("Detected lint/format scripts: fmt, lint");
    runCommand(pm, "fmt");
    runCommand(pm, "lint");
  } else if (scripts.format) {
    runCommand(pm, "format");
  } else if (scripts.fmt) {
    runCommand(pm, "fmt");
  } else if (scripts.lint) {
    runCommand(pm, "lint");
  } else {
    core.info("No matching scripts (check, format, lint, etc.) found in package.json.");
  }
}

export function executeRuff(isAutofix: boolean = process.env.GITHUB_WORKFLOW === "autofix.ci"): void {
  if (isAutofix) {
    core.info("Running Ruff in autofix mode");
    runRuffCommand("ruff check --fix .");
    runRuffCommand("ruff format .");
  } else {
    core.info("Running Ruff in check-only mode");
    runRuffCommand("ruff check .");
    runRuffCommand("ruff format --check .");
  }
}

export function run(): void {
  try {
    const rootDir = process.cwd();
    const hasJs =
      process.env.HAS_JS !== undefined
        ? process.env.HAS_JS === "true"
        : detectJsLanguage(rootDir);
    const hasPython =
      process.env.HAS_PYTHON !== undefined
        ? process.env.HAS_PYTHON === "true"
        : detectPythonLanguage(rootDir).hasPython;

    if (!fs.existsSync("package.json")) {
      core.info("No package.json found. Skipping scripts.");
    } else if (hasJs) {
      const pkg: PackageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const scripts = pkg.scripts || {};
      const pm = process.env.PACKAGE_MANAGER || "npm";
      executeScripts(scripts, pm);
    }

    if (!hasJs && !hasPython) {
      core.info("Neither JavaScript/TypeScript nor Python detected. Skipping lint and format steps.");
      return;
    }

    if (hasPython) {
      const isAutofix = process.env.GITHUB_WORKFLOW === "autofix.ci";
      executeRuff(isAutofix);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Failed to run scripts: ${message}`);
  }
}

function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  run();
}
