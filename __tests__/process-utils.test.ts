import { describe, expect, it } from "vite-plus/test";
import { isExecutableAvailable } from "../src/process-utils";

describe("process-utils", () => {
  describe("isExecutableAvailable()", () => {
    it("should return true for existent system binaries like node", () => {
      expect(isExecutableAvailable("node")).toBe(true);
    });

    it("should return false for non-existent binaries", () => {
      expect(isExecutableAvailable("non_existent_binary_xyz_123")).toBe(false);
    });

    it("should return false for invalid or malicious binary names", () => {
      expect(isExecutableAvailable("node; rm -rf /")).toBe(false);
      expect(isExecutableAvailable("node && echo hi")).toBe(false);
      expect(isExecutableAvailable("")).toBe(false);
    });
  });
});
