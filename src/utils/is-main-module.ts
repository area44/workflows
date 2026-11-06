import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Checks if the current module is the main entry point executed by Node.js.
 */
export function isMainModule(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(metaUrl) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
