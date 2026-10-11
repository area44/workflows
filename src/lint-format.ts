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

function isRuffInstalledOnPath(): boolean {
  try {
    execSync("ruff --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runRuffSingleCommand(cmd: string, hasUv: boolean): void {
  core.info(`Executing: ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (
      hasUv &&
      (errMsg.includes("No such file") ||
        errMsg.includes("not found") ||
        errMsg.includes("executable file not found"))
    ) {
      core.error(
        "Ruff is not declared or available in the uv project environment. Please add Ruff to development dependencies (e.g. run 'uv add --dev ruff').",
      );
    } else {
      core.error(`Command "${cmd}" failed`);
    }
    process.exit(1);
  }
}

export function executePythonRuff(
  isAutofix: boolean = process.env.GITHUB_WORKFLOW === "autofix.ci",
  hasUv: boolean = process.env.HAS_UV === "true",
): void {
  const ruffPrefix = hasUv ? "uv run --locked ruff" : "ruff";

  if (!hasUv && !isRuffInstalledOnPath()) {
    core.error(
      "Ruff executable is not available in the project environment. Please ensure Ruff is declared in your project development dependencies.",
    );
    process.exit(1);
  }

  const modeName = isAutofix ? "autofix" : "check-only";
  const ruffMsg = hasUv
    ? `Running project-managed Ruff via uv (${modeName} mode)`
    : `Running project-managed Ruff (${modeName} mode)`;
  core.info(ruffMsg);

  const checkCmd = isAutofix ? `${ruffPrefix} check --fix .` : `${ruffPrefix} check .`;
  const formatCmd = isAutofix ? `${ruffPrefix} format .` : `${ruffPrefix} format --check .`;

  runRuffSingleCommand(checkCmd, hasUv);
  runRuffSingleCommand(formatCmd, hasUv);
}

export function executeRuff(
  isAutofix: boolean = process.env.GITHUB_WORKFLOW === "autofix.ci",
  hasUv: boolean = process.env.HAS_UV === "true",
): void {
  executePythonRuff(isAutofix, hasUv);
}

export function run(): void {
  try {
    const rootDir = process.cwd();
    const hasJs =
      process.env.HAS_JS !== undefined ? process.env.HAS_JS === "true" : detectJsLanguage(rootDir);
    const pythonDetection = detectPythonLanguage(rootDir);
    const hasPython =
      process.env.HAS_PYTHON !== undefined
        ? process.env.HAS_PYTHON === "true"
        : pythonDetection.hasPython;
    const hasUv =
      process.env.HAS_UV !== undefined ? process.env.HAS_UV === "true" : pythonDetection.hasUv;

    if (!fs.existsSync("package.json")) {
      core.info("No package.json found. Skipping scripts.");
    } else if (hasJs) {
      const pkg: PackageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
      const scripts = pkg.scripts || {};
      const pm = process.env.PACKAGE_MANAGER || "npm";
      executeScripts(scripts, pm);
    }

    if (!hasJs && !hasPython) {
      core.info(
        "Neither JavaScript/TypeScript nor Python detected. Skipping lint and format steps.",
      );
      return;
    }

    if (hasPython) {
      const isAutofix = process.env.GITHUB_WORKFLOW === "autofix.ci";
      executePythonRuff(isAutofix, hasUv);
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
