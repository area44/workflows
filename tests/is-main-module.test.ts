import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { isMainModule } from "@/utils/is-main-module";

describe("isMainModule utility", () => {
  const originalArgv1 = process.argv[1];

  afterEach(() => {
    process.argv[1] = originalArgv1;
  });

  it("should return false if process.argv[1] is undefined or empty", () => {
    process.argv[1] = "";
    expect(isMainModule(import.meta.url)).toBe(false);
  });

  it("should return true when import.meta.url matches process.argv[1]", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    process.argv[1] = filePath;
    const metaUrl = pathToFileURL(filePath).href;
    expect(isMainModule(metaUrl)).toBe(true);
  });

  it("should return false when import.meta.url does not match process.argv[1]", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    const otherPath = path.resolve("src/autofix/index.ts");
    process.argv[1] = otherPath;
    const metaUrl = pathToFileURL(filePath).href;
    expect(isMainModule(metaUrl)).toBe(false);
  });

  it("should return false if realpathSync throws on non-existent process.argv[1]", () => {
    process.argv[1] = path.resolve("non-existent-directory/non-existent-file.ts");
    expect(isMainModule(import.meta.url)).toBe(false);
  });
});

describe("ESM URL scheme regression (ERR_UNSUPPORTED_ESM_URL_SCHEME)", () => {
  it("pathToFileURL produces a file:// URL (not a drive-letter protocol) on Windows", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    const url = pathToFileURL(filePath);
    expect(url.protocol).toBe("file:");
    // On Windows, the protocol must not be a drive letter like "c:"
    expect(url.protocol).not.toBe("c:");
    expect(url.protocol).not.toMatch(/^[a-z]:$/i);
  });

  it("pathToFileURL href uses forward slashes on Windows paths", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    const href = pathToFileURL(filePath).href;
    expect(href.startsWith("file://")).toBe(true);
    // Backslashes should not appear in the file:// URL path
    expect(href).not.toMatch(/file:\/\\[\\/]/);
  });

  it("fileURLToPath reverses pathToFileURL round-trip", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    const url = pathToFileURL(filePath);
    const back = fileURLToPath(url);
    // On Windows, round-trip may normalize separators/case; compare normalized
    expect(path.normalize(back)).toBe(path.normalize(filePath));
  });

  it("isMainModule works with file:// URL from pathToFileURL", () => {
    const filePath = path.resolve("src/resolve-environment.ts");
    process.argv[1] = filePath;
    const metaUrl = pathToFileURL(filePath).href;
    expect(isMainModule(metaUrl)).toBe(true);
  });
});
