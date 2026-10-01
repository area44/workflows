import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== "test" && isMainModule(import.meta.url)) {
  setSiteVariables();
}
