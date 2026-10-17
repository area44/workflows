import { execSync } from "node:child_process";

/**
 * Checks whether a CLI executable binary is available in system PATH.
 * Validates the binary name format to prevent command injection.
 * Cross-platform support for Windows (`where`) and Unix-like (`command -v`) environments.
 */
export function isExecutableAvailable(binName: string): boolean {
  if (!binName || !/^[a-z0-9_.-]+$/i.test(binName)) {
    return false;
  }
  try {
    const cmd = process.platform === "win32" ? `where ${binName}` : `command -v ${binName}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
