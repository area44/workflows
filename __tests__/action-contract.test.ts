import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  detectBreakingChanges,
  isPublicAction,
  parseActionContract,
  parseActionContractYaml,
  PUBLIC_ACTIONS,
  PublicActionContract,
  validateAllPublicActionContracts,
} from "../src/action-contract";

describe("Public Action API Contract Specification", () => {
  const rootDir = path.resolve(process.cwd());

  describe("Public Action Identification", () => {
    it("should list all 4 public actions", () => {
      expect(PUBLIC_ACTIONS).toEqual(["astro", "vite", "vite-plus", "lint-format"]);
    });

    it("should correctly identify public actions via type guard", () => {
      expect(isPublicAction("astro")).toBe(true);
      expect(isPublicAction("vite")).toBe(true);
      expect(isPublicAction("vite-plus")).toBe(true);
      expect(isPublicAction("lint-format")).toBe(true);
      expect(isPublicAction("unknown-action")).toBe(false);
      expect(isPublicAction("")).toBe(false);
    });
  });

  describe("Repository Production Public Actions Contract Invariants", () => {
    it("should parse and validate all repository public action contracts from action.yml", () => {
      const contracts = validateAllPublicActionContracts(rootDir);
      expect(Object.keys(contracts)).toEqual([...PUBLIC_ACTIONS]);

      for (const actionName of PUBLIC_ACTIONS) {
        const contract = contracts[actionName];
        expect(contract.action).toBe(actionName);
        expect(typeof contract.name).toBe("string");
        expect(contract.name.trim()).not.toBe("");
        expect(typeof contract.description).toBe("string");
        expect(contract.description.trim()).not.toBe("");

        expect(Array.isArray(contract.inputs)).toBe(true);
        for (const input of contract.inputs) {
          expect(typeof input.name).toBe("string");
          expect(input.name.trim()).not.toBe("");
          expect(typeof input.description).toBe("string");
          expect(input.description.trim()).not.toBe("");
          expect(typeof input.required).toBe("boolean");
          if (input.default !== undefined) {
            expect(typeof input.default).toBe("string");
          }
          if (input.required) {
            expect(input.default).toBeUndefined();
          }
        }

        expect(Array.isArray(contract.outputs)).toBe(true);
        for (const output of contract.outputs) {
          expect(typeof output.name).toBe("string");
          expect(output.name.trim()).not.toBe("");
          expect(typeof output.description).toBe("string");
          expect(output.description.trim()).not.toBe("");
          if (output.value !== undefined) {
            expect(typeof output.value).toBe("string");
          }
        }
      }
    });

    it.each(PUBLIC_ACTIONS)(
      "action '%s' should parse directly from its action.yml as the single source of truth",
      (actionName) => {
        const contract = parseActionContract(actionName, rootDir);
        expect(contract.action).toBe(actionName);
        expect(contract.name).toBeTruthy();
        expect(contract.description).toBeTruthy();
      },
    );
  });

  describe("Contract Validation Rules & Error Messages", () => {
    it("should reject missing action.yml file", () => {
      expect(() => parseActionContract("non-existent-action", rootDir)).toThrow(
        "Invalid public action contract:\naction: non-existent-action\nproblem: missing action.yml or action.yaml file",
      );
    });

    it("should reject malformed YAML", () => {
      const malformedYaml = `
name: Broken Action
description: test
inputs: [invalid yaml:
`;
      expect(() => parseActionContractYaml("test-action", malformedYaml)).toThrow(
        "Invalid public action contract:\naction: test-action\nproblem: malformed YAML metadata",
      );
    });

    it("should reject missing name field", () => {
      const yaml = `
description: Missing name
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\nproblem: missing or invalid \"name\" field",
      );
    });

    it("should reject missing description field", () => {
      const yaml = `
name: Missing Description Action
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\nproblem: missing or invalid \"description\" field",
      );
    });

    it("should reject duplicate input declarations", () => {
      const yaml = `
name: Duplicate Input Action
description: test
inputs:
  path:
    description: "First path"
  path:
    description: "Second path"
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\nproblem: duplicate declaration found in YAML",
      );
    });

    it("should reject duplicate output declarations", () => {
      const yaml = `
name: Duplicate Output Action
description: test
outputs:
  runtime:
    description: "First runtime"
  runtime:
    description: "Second runtime"
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\nproblem: duplicate declaration found in YAML",
      );
    });

    it("should reject required input with default value", () => {
      const yaml = `
name: Invalid Required Default Action
description: test
inputs:
  path:
    description: "Build path"
    required: true
    default: "dist"
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\ninput: path\nproblem: required input cannot have a default value",
      );
    });

    it("should reject non-boolean required field in input", () => {
      const yaml = `
name: Invalid Required Type Action
description: test
inputs:
  path:
    description: "Build path"
    required: "yes"
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\ninput: path\nproblem: \"required\" field must be a boolean",
      );
    });

    it("should reject missing input description", () => {
      const yaml = `
name: Invalid Input Description
description: test
inputs:
  path:
    required: false
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\ninput: path\nproblem: missing or invalid description",
      );
    });

    it("should reject missing output description", () => {
      const yaml = `
name: Invalid Output Description
description: test
outputs:
  runtime:
    value: "\${{ steps.foo.outputs.bar }}"
`;
      expect(() => parseActionContractYaml("test-action", yaml)).toThrow(
        "Invalid public action contract:\naction: test-action\noutput: runtime\nproblem: missing or invalid description",
      );
    });
  });

  describe("Breaking Change Detection Algorithm", () => {
    const baselineContract: PublicActionContract = {
      action: "sample-action",
      name: "Sample Action",
      description: "Test action",
      inputs: [
        { name: "path", description: "Path", required: false, default: "dist" },
        { name: "runtime", description: "Runtime", required: false },
        { name: "build-command", description: "Build command", required: false },
      ],
      outputs: [
        { name: "node-version", description: "Node version" },
        { name: "runtime", description: "Runtime" },
      ],
    };

    it("should detect no breaking changes when contract is identical", () => {
      const changes = detectBreakingChanges(baselineContract, baselineContract);
      expect(changes).toHaveLength(0);
    });

    it("should detect removed public input", () => {
      const target: PublicActionContract = {
        ...baselineContract,
        inputs: baselineContract.inputs.filter((i) => i.name !== "build-command"),
      };
      const changes = detectBreakingChanges(baselineContract, target);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("REMOVED_INPUT");
      expect(changes[0].input).toBe("build-command");
    });

    it("should detect removed public output", () => {
      const target: PublicActionContract = {
        ...baselineContract,
        outputs: baselineContract.outputs.filter((o) => o.name !== "runtime"),
      };
      const changes = detectBreakingChanges(baselineContract, target);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("REMOVED_OUTPUT");
      expect(changes[0].output).toBe("runtime");
    });

    it("should detect optional to required input change", () => {
      const target: PublicActionContract = {
        ...baselineContract,
        inputs: baselineContract.inputs.map((i) =>
          i.name === "runtime" ? { ...i, required: true } : i,
        ),
      };
      const changes = detectBreakingChanges(baselineContract, target);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("REQUIRED_CHANGED");
      expect(changes[0].input).toBe("runtime");
    });

    it("should detect input default value change", () => {
      const target: PublicActionContract = {
        ...baselineContract,
        inputs: baselineContract.inputs.map((i) =>
          i.name === "path" ? { ...i, default: "build" } : i,
        ),
      };
      const changes = detectBreakingChanges(baselineContract, target);
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("DEFAULT_CHANGED");
      expect(changes[0].input).toBe("path");
    });
  });
});
