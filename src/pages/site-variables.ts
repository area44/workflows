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

  if (site.includes("?") || site.includes("#")) {
    throw new Error("Invalid SITE URL: query strings and fragments are not supported.");
  }

  try {
    const parsed = new URL(site);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Invalid SITE URL scheme '${parsed.protocol}'. Expected 'http:' or 'https:'.`,
      );
    }
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      throw new Error("Invalid SITE URL: path components are not supported for SITE origin.");
    }
    return parsed.origin;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith("Invalid SITE URL") ||
        err.message.startsWith("Invalid SITE URL scheme"))
    ) {
      throw err;
    }
    throw new Error(`Invalid SITE URL '${site}': must be a valid http or https URL.`);
  }
}

export function validateAndNormalizeBasePath(rawVal: string): string {
  const val = rawVal.trim();
  if (!val) {
    return "";
  }

  if (/^[a-zA-Z][a-zA-Z0-9+-.]*:\/\//.test(val) || /^\/\/[^/]/.test(val)) {
    throw new Error("Invalid base/base_url: absolute URLs are not supported.");
  }

  // eslint-disable-next-line no-control-regex
  if (
    val.includes("?") ||
    val.includes("#") ||
    val.includes("\\") ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1F\x7F]/.test(val) ||
    val.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid base/base_url: expected a valid path prefix.");
  }

  const leading = val.startsWith("/") ? "" : "/";
  const trailing = val.endsWith("/") ? "" : "/";
  return `${leading}${val}${trailing}`.replace(/\/+/g, "/");
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

  const rawBase = env.BASE?.trim();
  const rawBaseUrl = env.BASE_URL?.trim();

  const normBase = rawBase ? validateAndNormalizeBasePath(rawBase) : "";
  const normBaseUrl = rawBaseUrl ? validateAndNormalizeBasePath(rawBaseUrl) : "";

  let base = "";
  if (normBase && normBaseUrl) {
    if (normBase !== normBaseUrl) {
      throw new Error(
        "Conflicting base/base_url configuration: BASE and BASE_URL specify different paths.",
      );
    }
    base = normBase;
  } else if (normBase) {
    base = normBase;
  } else if (normBaseUrl) {
    base = normBaseUrl;
  } else {
    const isPrimary = repo === `${owner}.github.io`;
    base = isPrimary ? "/" : `/${repo}/`;
  }

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
      core.exportVariable("BASE_URL", vars.base);
      core.info(`Set SITE=${vars.site}`);
      core.info(`Set BASE=${vars.base}`);
      core.info(`Set BASE_URL=${vars.base}`);
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
