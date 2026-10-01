import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PublicActionContract } from "../src/action-contract.js";
import { detectBreakingChanges } from "../src/action-contract.js";
import { WorkflowError } from "../src/errors.js";
import {
  classifyChangeImpact,
  getRepositoryVersion,
  isValidSemVer,
  parseSemVer,
  validateRepositoryVersion,
} from "../src/versioning.js";

describe("Versioning Model", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "versioning-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("SemVer Parsing & Validation", () => {
    it("validates correct SemVer strings", () => {
      expect(isValidSemVer("1.0.0")).toBe(true);
      expect(isValidSemVer("0.1.0-beta.1")).toBe(true);
      expect(isValidSemVer("2.1.3+20230101")).toBe(true);
      expect(isValidSemVer("10.20.30-alpha.1+build.123")).toBe(true);
    });

    it("rejects invalid SemVer strings", () => {
      expect(isValidSemVer("1.0")).toBe(false);
      expect(isValidSemVer("v1.0.0")).toBe(false);
      expect(isValidSemVer("1.0.0.0")).toBe(false);
      expect(isValidSemVer("1.a.0")).toBe(false);
      expect(isValidSemVer("")).toBe(false);
      expect(isValidSemVer("   ")).toBe(false);
    });

    it("parses SemVer components correctly", () => {
      const parsed = parseSemVer("1.2.3-beta.2+exp.sha.5114f85");
      expect(parsed).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: "beta.2",
        build: "exp.sha.5114f85",
      });
    });

    it("throws WorkflowError on malformed SemVer strings", () => {
      expect(() => parseSemVer("invalid")).toThrow(WorkflowError);
      try {
        parseSemVer("invalid");
      } catch (err) {
        expect(err).toBeInstanceOf(WorkflowError);
        expect((err as WorkflowError).code).toBe("INVALID_INPUT");
      }
    });
  });

  describe("getRepositoryVersion", () => {
    it("returns valid version and source for the current workspace", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      const res = getRepositoryVersion(process.cwd());
      expect(res.source).toBe("package.json");
      expect(isValidSemVer(res.version)).toBe(true);
      expect(res.version).toBe(pkg.version);
    });

    it("throws MISSING_CONFIGURATION when package.json does not exist", () => {
      expect(() => getRepositoryVersion(tempDir)).toThrow(WorkflowError);
      try {
        getRepositoryVersion(tempDir);
      } catch (err) {
        expect((err as WorkflowError).code).toBe("MISSING_CONFIGURATION");
      }
    });

    it("throws INVALID_INPUT when package.json is missing required version field", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));
      expect(() => getRepositoryVersion(tempDir)).toThrow(WorkflowError);
      try {
        getRepositoryVersion(tempDir);
      } catch (err) {
        expect((err as WorkflowError).code).toBe("INVALID_INPUT");
        expect((err as WorkflowError).message).toContain("missing required 'version' field");
      }
    });

    it("throws INVALID_INPUT when package.json contains non-SemVer version", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test", version: "invalid.version" }),
      );
      expect(() => getRepositoryVersion(tempDir)).toThrow(WorkflowError);
      try {
        getRepositoryVersion(tempDir);
      } catch (err) {
        expect((err as WorkflowError).code).toBe("INVALID_INPUT");
        expect((err as WorkflowError).message).toContain("not a valid Semantic Version");
      }
    });
  });

  describe("validateRepositoryVersion", () => {
    it("validates current workspace version successfully", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
      const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"));
      const res = validateRepositoryVersion(process.cwd());
      expect(res.version).toBe(pkg.version);
      expect(res.packageLockVersion).toBe(lock.version);
    });

    it("throws INVALID_INPUT when package-lock.json version conflicts with package.json", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" }),
      );
      fs.writeFileSync(
        path.join(tempDir, "package-lock.json"),
        JSON.stringify({ name: "test", version: "1.1.0" }),
      );
      fs.writeFileSync(
        path.join(tempDir, "COMPATIBILITY.md"),
        "# Compatibility\nRelease versioning is tied to package.json (authoritative source).",
      );

      expect(() => validateRepositoryVersion(tempDir)).toThrow(WorkflowError);
      try {
        validateRepositoryVersion(tempDir);
      } catch (err) {
        expect((err as WorkflowError).code).toBe("INVALID_INPUT");
        expect((err as WorkflowError).message).toContain("Conflicting version declarations");
      }
    });

    it("throws MISSING_CONFIGURATION when COMPATIBILITY.md lacks authoritative source documentation", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" }),
      );
      fs.writeFileSync(
        path.join(tempDir, "COMPATIBILITY.md"),
        "# Compatibility\nThis file describes compatibility.",
      );

      expect(() => validateRepositoryVersion(tempDir)).toThrow(WorkflowError);
      try {
        validateRepositoryVersion(tempDir);
      } catch (err) {
        expect((err as WorkflowError).code).toBe("MISSING_CONFIGURATION");
        expect((err as WorkflowError).message).toContain(
          "COMPATIBILITY.md must document package.json as the authoritative version source",
        );
      }
    });
  });

  describe("classifyChangeImpact", () => {
    it("classifies breaking contract changes as major", () => {
      const baseline: PublicActionContract = {
        action: "vite",
        name: "Vite Action",
        description: "Test action",
        inputs: [{ name: "path", description: "Path", required: false, default: "dist" }],
        outputs: [],
      };
      const target: PublicActionContract = {
        action: "vite",
        name: "Vite Action",
        description: "Test action",
        inputs: [], // input removed
        outputs: [],
      };

      const breaking = detectBreakingChanges(baseline, target);
      expect(breaking.length).toBeGreaterThan(0);

      const impact = classifyChangeImpact({ breakingContractChanges: breaking });
      expect(impact).toBe("major");
    });

    it("classifies removed matrix combinations as major", () => {
      const impact = classifyChangeImpact({ removedMatrixCombinations: 1 });
      expect(impact).toBe("major");
    });

    it("classifies added matrix combinations or new inputs as minor", () => {
      expect(classifyChangeImpact({ addedMatrixCombinations: 1 })).toBe("minor");
      expect(classifyChangeImpact({ newInputsOrOutputs: 1 })).toBe("minor");
      expect(classifyChangeImpact({ backwardCompatibleFeatures: true })).toBe("minor");
    });

    it("classifies bug fixes or doc-only changes as patch", () => {
      expect(classifyChangeImpact({ isBugFixOrDocOnly: true })).toBe("patch");
      expect(classifyChangeImpact({})).toBe("patch");
    });
  });
});
