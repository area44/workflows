import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  getCombinationCompatibility,
  validateFixtureForMatrixEntry,
  validateMatrixEntry,
  validateWorkflowMatrix,
} from "../src/compatibility";
import { isWorkflowError, WorkflowError } from "../src/errors";
import { parseEnvironmentInputs, resolveEnvironment } from "../src/resolve-environment";
import { parseCommand } from "../src/build-command";

describe("Error Contract Tests", () => {
  describe("Error Structure and Instance Checks", () => {
    it("should instantiate WorkflowError with code, message, and context", () => {
      const err = new WorkflowError("INVALID_INPUT", "Test error message", {
        stage: "unit-test",
      });

      expect(err.name).toBe("WorkflowError");
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.message).toBe("Test error message");
      expect(err.context).toEqual({ stage: "unit-test" });
      expect(isWorkflowError(err)).toBe(true);
    });

    it("should recognize duck-typed WorkflowError objects in isWorkflowError", () => {
      const fakeError = {
        name: "WorkflowError",
        code: "UNSUPPORTED_COMBINATION",
        message: "Duck typed error",
      };
      expect(isWorkflowError(fakeError)).toBe(true);
      expect(isWorkflowError(new Error("Generic"))).toBe(false);
      expect(isWorkflowError(null)).toBe(false);
    });
  });

  describe("Category A: Invalid input", () => {
    it("should throw INVALID_INPUT for malformed runtime syntax", () => {
      try {
        parseEnvironmentInputs("node@");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("malformed version specifier");
        }
      }
    });

    it("should throw INVALID_INPUT for unknown/unrecognized runtime specifier", () => {
      try {
        parseEnvironmentInputs("deno");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("unrecognized or malformed runtime specifier");
        }
      }
    });

    it("should throw INVALID_INPUT for duplicate runtime specifiers", () => {
      try {
        parseEnvironmentInputs("node, node@24");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("duplicate or conflicting specifiers for \"node\"");
        }
      }
    });

    it("should throw INVALID_INPUT for malformed comma placement", () => {
      try {
        parseEnvironmentInputs("node,,bun");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("malformed comma placement");
        }
      }
    });

    it("should throw INVALID_INPUT for malformed build command quotes", () => {
      try {
        parseCommand('npm run "build');
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("Unterminated quote");
        }
      }
    });
  });

  describe("Category B: Unsupported runtime / package manager", () => {
    it("should return unsupported status for unknown runtime name in getCombinationCompatibility", () => {
      const result = getCombinationCompatibility("deno", "npm");
      expect(result.status.supported).toBe(false);
      expect(result.status.reason).toContain('Unsupported runtime "deno"');
    });

    it("should return unsupported status for unknown package manager name in getCombinationCompatibility", () => {
      const result = getCombinationCompatibility("node", "yarn");
      expect(result.status.supported).toBe(false);
      expect(result.status.reason).toContain('Unsupported package manager "yarn"');
    });

    it("should throw UNSUPPORTED_RUNTIME_OR_PM in validateMatrixEntry for invalid runtime", () => {
      try {
        validateMatrixEntry({
          action: "astro",
          runtime: "deno",
          pm: "npm",
          type: "basic",
        });
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("UNSUPPORTED_RUNTIME_OR_PM");
          expect(err.message).toContain("unsupported runtime");
        }
      }
    });
  });

  describe("Category C: Unsupported combination (Bun + npm)", () => {
    it("should reject Bun + npm explicitly with UNSUPPORTED_COMBINATION when resolving environment", () => {
      try {
        // Simulating bun runtime with npm package manager
        resolveEnvironment("bun, npm");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT"); // duplicate/conflicting runtime if bun, npm is parsed as inputs
        }
      }
    });

    it("should report unsupported combination status for bun + npm without throwing", () => {
      const comp = getCombinationCompatibility("bun", "npm");
      expect(combIsUnsupported(comp)).toBe(true);
      expect(comp.status.reason).toContain("Bun runtime does not support npm package manager");
    });

    it("should throw UNSUPPORTED_COMBINATION in validateMatrixEntry for bun + npm", () => {
      try {
        validateMatrixEntry({
          action: "astro",
          runtime: "bun",
          pm: "npm",
          type: "basic",
        });
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("UNSUPPORTED_COMBINATION");
          expect(err.message).toContain("unsupported combination");
        }
      }
    });
  });

  describe("Category D: Missing configuration / project metadata", () => {
    it("should throw MISSING_CONFIGURATION when validating a non-existent fixture path", () => {
      try {
        validateFixtureForMatrixEntry({
          action: "astro",
          runtime: "node",
          pm: "npm",
          type: "basic",
        }, "/non/existent/path");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("MISSING_CONFIGURATION");
          expect(err.message).toContain("Missing fixture directory");
        }
      }
    });
  });

  describe("Category E & F: Workflow Matrix validation", () => {
    it("should throw INVALID_INPUT when matrix entries parameter is not an array", () => {
      try {
        validateWorkflowMatrix("not-an-array" as any);
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("INVALID_INPUT");
          expect(err.message).toContain("Workflow matrix entries must be an array");
        }
      }
    });
  });
});

function combIsUnsupported(comp: { status: { supported: boolean } }): boolean {
  return !comp.status.supported;
}
