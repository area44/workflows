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

  if (!repoFull || !owner) {
    return null;
  }

  const parts = repoFull.split("/");
  if (parts.length !== 2) {
    return null;
  }

  const repoOwner = parts[0].trim();
  const repoName = parts[1].trim();

  if (!repoOwner || !repoName) {
    return null;
  }

  if (repoOwner.toLowerCase() !== owner.trim().toLowerCase()) {
    return null;
  }

  const site = `https://${owner.trim()}.github.io`;
  const isPrimary = repoName.toLowerCase() === `${owner.trim().toLowerCase()}.github.io`;
  const base = isPrimary ? "/" : `/${repoName}/`;

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

  if (!repoFull || !owner) {
    core.warning("GITHUB_REPOSITORY or GITHUB_REPOSITORY_OWNER not set. Skipping site variables.");
    return;
  }

  const parts = repoFull.split("/");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    core.warning(
      `Invalid GITHUB_REPOSITORY format '${repoFull}'. Expected 'owner/repo'. Skipping site variables.`,
    );
    return;
  }

  const repoOwner = parts[0].trim();
  if (repoOwner.toLowerCase() !== owner.trim().toLowerCase()) {
    core.warning(
      `Inconsistent repository owner metadata: GITHUB_REPOSITORY owner ('${repoOwner}') does not match GITHUB_REPOSITORY_OWNER ('${owner}'). Skipping site variables.`,
    );
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
  } else {
    core.warning(
      "Failed to resolve site variables from repository metadata. Skipping site variables.",
    );
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
