import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export interface SiteVariables {
  site: string;
  base: string;
}

/**
 * Resolves SITE, BASE, and BASE_URL automatically from GitHub repository metadata:
 * - SITE: https://${owner}.github.io
 * - BASE / BASE_URL: '/' for primary repository (${owner}.github.io), otherwise /${repo}/
 */
export function resolveSiteVariables(
  env: Record<string, string | undefined> = process.env,
): SiteVariables | null {
  const repoFull = env.GITHUB_REPOSITORY || "";
  const owner = env.GITHUB_REPOSITORY_OWNER || "";
  const repo = repoFull.split("/")[1] || "";

  if (!owner || !repo) {
    return null;
  }

  const site = `https://${owner}.github.io`;
  const isPrimary = repo === `${owner}.github.io`;
  const base = isPrimary ? "/" : `/${repo}/`;

  return { site, base };
}

export function setSiteVariables(): void {
  const actionPath = process.env.GITHUB_ACTION_PATH || process.env.ACTION_PATH || "";
  const actionName = actionPath.split("/").pop() || "";

  if (actionName !== "pages") {
    return;
  }

  const repoFull = process.env.GITHUB_REPOSITORY || "";
  const owner = process.env.GITHUB_REPOSITORY_OWNER || "";
  const repo = repoFull.split("/")[1] || "";

  if (!owner || !repo) {
    core.warning("GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.");
    return;
  }

  const vars = resolveSiteVariables(process.env);
  if (vars) {
    core.exportVariable("SITE", vars.site);
    core.exportVariable("BASE", vars.base);
    core.exportVariable("BASE_URL", vars.base);
    core.info(`Set SITE=${vars.site}`);
    core.info(`Set BASE=${vars.base}`);
    core.info(`Set BASE_URL=${vars.base}`);
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
