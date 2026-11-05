import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { isMainModule } from "../src/utils/is-main-module.js";

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
