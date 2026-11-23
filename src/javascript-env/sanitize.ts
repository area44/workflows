export function sanitizePackageManager(pm: string): string {
  const clean = pm.trim().toLowerCase();
  if (/^[a-z0-9_.-]+$/.test(clean)) {
    return clean;
  }
  return "npm";
}

export function isSupportedPackageManager(pmName: string): pmName is "npm" | "pnpm" | "bun" {
  return pmName === "npm" || pmName === "pnpm" || pmName === "bun";
}