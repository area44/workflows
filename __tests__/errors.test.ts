import { describe, expect, it } from "vite-plus/test";

import { isWorkflowError, WorkflowError } from "../src/errors";
import {
  parseEnvironmentInputs,
  validateRuntimePackageManagerCompatibility,
} from "../src/resolve-environment";
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

  describe("Invalid input", () => {
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

  describe("Unsupported runtime / package manager", () => {
    it("should throw UNSUPPORTED_RUNTIME_OR_PM in validateRuntimePackageManagerCompatibility for invalid runtime", () => {
      try {
        validateRuntimePackageManagerCompatibility("deno", "npm");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("UNSUPPORTED_RUNTIME_OR_PM");
          expect(err.message).toContain('Unsupported runtime "deno"');
        }
      }
    });

    it("should throw UNSUPPORTED_RUNTIME_OR_PM in validateRuntimePackageManagerCompatibility for invalid package manager", () => {
      try {
        validateRuntimePackageManagerCompatibility("node", "yarn");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("UNSUPPORTED_RUNTIME_OR_PM");
          expect(err.message).toContain('Unsupported package manager "yarn"');
        }
      }
    });
  });

  describe("Unsupported combination (Bun + npm)", () => {
    it("should throw UNSUPPORTED_COMBINATION when calling validateRuntimePackageManagerCompatibility('bun', 'npm')", () => {
      try {
        validateRuntimePackageManagerCompatibility("bun", "npm");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        expect(isWorkflowError(err)).toBe(true);
        if (isWorkflowError(err)) {
          expect(err.code).toBe("UNSUPPORTED_COMBINATION");
          expect(err.message).toContain("Bun runtime does not support npm package manager");
        }
      }
    });
  });
});
