import * as core from "@actions/core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export interface SiteVariables {
  site: string;
  base: string;
}

/**
 * Resolves SITE and BASE configuration values according to precedence and normalization rules:
 * - SITE: explicit env.SITE (validated as HTTP/HTTPS URL and normalized without trailing slash) > default https://${owner}.github.io
 * - BASE: explicit env.BASE (normalized with leading/trailing slashes) > default ('/' for primary repository, otherwise /${repo}/)
 */
function resolveSiteUrl(rawSite: string | undefined, owner: string): string {
  const site = rawSite?.trim();
  if (!site) {
    return `https://${owner}.github.io`;
  }

  try {
    const parsed = new URL(site);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Invalid SITE URL scheme '${parsed.protocol}'. Expected 'http:' or 'https:'.`,
      );
    }
    const cleanPath = parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    return `${parsed.origin}${cleanPath}`;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid SITE URL scheme")) {
      throw err;
    }
    throw new Error(`Invalid SITE URL '${site}': must be a valid http or https URL.`);
  }
}

function resolveBasePath(rawBase: string | undefined, repo: string, owner: string): string {
  const base = rawBase?.trim();
  if (!base) {
    const isPrimary = repo === `${owner}.github.io`;
    return isPrimary ? "/" : `/${repo}/`;
  }

  const leading = base.startsWith("/") ? "" : "/";
  const trailing = base.endsWith("/") ? "" : "/";
  return `${leading}${base}${trailing}`.replace(/\/+/g, "/");
}

export function resolveSiteVariables(
  env: Record<string, string | undefined> = process.env,
): SiteVariables | null {
  const repoFull = env.GITHUB_REPOSITORY || "";
  const owner = env.GITHUB_REPOSITORY_OWNER || "";
  const repo = repoFull.split("/")[1] || "";

  if (!owner || !repo) {
    return null;
  }

  const site = resolveSiteUrl(env.SITE, owner);
  const base = resolveBasePath(env.BASE, repo, owner);

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

  try {
    const vars = resolveSiteVariables(process.env);
    if (vars) {
      core.exportVariable("SITE", vars.site);
      core.exportVariable("BASE", vars.base);
      core.info(`Set SITE=${vars.site}`);
      core.info(`Set BASE=${vars.base}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Failed to resolve site variables: ${msg}`);
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
