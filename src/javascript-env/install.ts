import type { JsInstallationPlan, JsPackageManagerInfo, SupportedPackageManager } from "@/javascript-env/types";
import { sanitizePackageManager, isSupportedPackageManager } from "@/javascript-env/sanitize";

export function getJsInstallationPlan(pmInput: string | JsPackageManagerInfo): JsInstallationPlan {
  const pmNameRaw = typeof pmInput === "string" ? sanitizePackageManager(pmInput) : pmInput.name;

  if (!isSupportedPackageManager(pmNameRaw)) {
    throw new Error(
      `Unsupported package manager '${pmNameRaw}'. Supported package managers are npm, pnpm, and bun.`,
    );
  }

  const pmName: SupportedPackageManager = pmNameRaw;

  switch (pmName) {
    case "npm": {
      return {
        packageManager: "npm",
        command: "npm",
        args: ["install"],
      };
    }
    case "pnpm": {
      return {
        packageManager: "pnpm",
        command: "pnpm",
        args: ["install", "--no-frozen-lockfile"],
      };
    }
    case "bun": {
      return {
        packageManager: "bun",
        command: "bun",
        args: ["install"],
      };
    }
  }
}