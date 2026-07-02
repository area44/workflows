import * as core from "@actions/core";
import { execSync } from "node:child_process";
import fs from "node:fs";

function runCommand(command: string): void {
  core.info(`Executing: ${command}`);
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Command failed: ${message}`);
    process.exit(1);
  }
}

export function run(): void {
  const pm = process.env.PACKAGE_MANAGER || "npm";
  const frozen = process.env.FROZEN === "true";

  core.info(`Installing dependencies with ${pm} (frozen: ${frozen})`);

  switch (pm) {
    case "pnpm":
      runCommand(frozen ? "pnpm install --frozen-lockfile" : "pnpm install --no-frozen-lockfile");
      break;
    case "bun":
      runCommand(frozen ? "bun install --frozen-lockfile" : "bun install");
      break;
    case "yarn":
      runCommand(frozen ? "yarn install --frozen-lockfile" : "yarn install");
      break;
    case "npm":
      if (frozen && fs.existsSync("package-lock.json")) {
        runCommand("npm ci");
      } else {
        runCommand("npm install");
      }
      break;
    default:
      runCommand(`${pm} install`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run();
}
