import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

export const PUBLIC_ACTIONS = ["astro", "vite", "vite-plus", "lint-format"] as const;
export type PublicActionName = (typeof PUBLIC_ACTIONS)[number];

export interface ActionInputContract {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface ActionOutputContract {
  name: string;
  description: string;
  value?: string;
}

export interface PublicActionContract {
  action: string;
  name: string;
  description: string;
  inputs: ActionInputContract[];
  outputs: ActionOutputContract[];
}

export interface BreakingChange {
  type: "REMOVED_INPUT" | "REMOVED_OUTPUT" | "REQUIRED_CHANGED" | "DEFAULT_CHANGED";
  input?: string;
  output?: string;
  problem: string;
}

export function isPublicAction(action: string): action is PublicActionName {
  return (PUBLIC_ACTIONS as readonly string[]).includes(action);
}

/**
 * Validates and parses raw YAML content for a public action contract.
 */
export function parseActionContractYaml(
  actionName: string,
  yamlContent: string,
): PublicActionContract {
  const doc = parseDocument(yamlContent);

  if (doc.errors.length > 0) {
    const firstError = doc.errors[0];
    const problem =
      firstError.code === "DUPLICATE_KEY"
        ? `duplicate declaration found in YAML: ${firstError.message}`
        : `malformed YAML metadata: ${firstError.message}`;
    throw new Error(`Invalid public action contract:\naction: ${actionName}\nproblem: ${problem}`);
  }

  const parsed = doc.toJS();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid public action contract:\naction: ${actionName}\nproblem: action metadata must be an object`,
    );
  }

  const name = parsed.name;
  if (!name || typeof name !== "string" || name.trim() === "") {
    throw new Error(
      `Invalid public action contract:\naction: ${actionName}\nproblem: missing or invalid "name" field`,
    );
  }

  const description = parsed.description;
  if (!description || typeof description !== "string" || description.trim() === "") {
    throw new Error(
      `Invalid public action contract:\naction: ${actionName}\nproblem: missing or invalid "description" field`,
    );
  }

  const inputs: ActionInputContract[] = [];
  if (parsed.inputs !== undefined) {
    if (!parsed.inputs || typeof parsed.inputs !== "object" || Array.isArray(parsed.inputs)) {
      throw new Error(
        `Invalid public action contract:\naction: ${actionName}\nproblem: "inputs" must be an object`,
      );
    }

    const seenInputs = new Set<string>();
    for (const [inputKey, inputVal] of Object.entries(parsed.inputs)) {
      if (seenInputs.has(inputKey)) {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: duplicate input declaration`,
        );
      }
      seenInputs.add(inputKey);

      if (!inputVal || typeof inputVal !== "object" || Array.isArray(inputVal)) {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: input declaration must be an object`,
        );
      }

      const inputDesc = (inputVal as { description?: unknown }).description;
      if (!inputDesc || typeof inputDesc !== "string" || inputDesc.trim() === "") {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: missing or invalid description`,
        );
      }

      const requiredRaw = (inputVal as { required?: unknown }).required;
      let required = false;
      if (requiredRaw !== undefined) {
        if (typeof requiredRaw !== "boolean") {
          throw new Error(
            `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: "required" field must be a boolean`,
          );
        }
        required = requiredRaw;
      }

      const defaultRaw = (inputVal as { default?: unknown }).default;
      let defaultValue: string | undefined;
      if (defaultRaw !== undefined) {
        if (
          typeof defaultRaw !== "string" &&
          typeof defaultRaw !== "number" &&
          typeof defaultRaw !== "boolean"
        ) {
          throw new Error(
            `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: invalid default value type`,
          );
        }
        defaultValue = String(defaultRaw);
      }

      if (required && defaultValue !== undefined) {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\ninput: ${inputKey}\nproblem: required input cannot have a default value`,
        );
      }

      inputs.push({
        name: inputKey,
        description: inputDesc,
        required,
        default: defaultValue,
      });
    }
  }

  const outputs: ActionOutputContract[] = [];
  if (parsed.outputs !== undefined) {
    if (!parsed.outputs || typeof parsed.outputs !== "object" || Array.isArray(parsed.outputs)) {
      throw new Error(
        `Invalid public action contract:\naction: ${actionName}\nproblem: "outputs" must be an object`,
      );
    }

    const seenOutputs = new Set<string>();
    for (const [outputKey, outputVal] of Object.entries(parsed.outputs)) {
      if (seenOutputs.has(outputKey)) {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\noutput: ${outputKey}\nproblem: duplicate output declaration`,
        );
      }
      seenOutputs.add(outputKey);

      if (!outputVal || typeof outputVal !== "object" || Array.isArray(outputVal)) {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\noutput: ${outputKey}\nproblem: output declaration must be an object`,
        );
      }

      const outputDesc = (outputVal as { description?: unknown }).description;
      if (!outputDesc || typeof outputDesc !== "string" || outputDesc.trim() === "") {
        throw new Error(
          `Invalid public action contract:\naction: ${actionName}\noutput: ${outputKey}\nproblem: missing or invalid description`,
        );
      }

      const valueRaw = (outputVal as { value?: unknown }).value;
      let value: string | undefined;
      if (valueRaw !== undefined) {
        if (typeof valueRaw !== "string") {
          throw new Error(
            `Invalid public action contract:\naction: ${actionName}\noutput: ${outputKey}\nproblem: invalid output value declaration`,
          );
        }
        value = valueRaw;
      }

      outputs.push({
        name: outputKey,
        description: outputDesc,
        value,
      });
    }
  }

  return {
    action: actionName,
    name,
    description,
    inputs,
    outputs,
  };
}

/**
 * Parses and validates an action.yml file for a public action directory.
 */
export function parseActionContract(
  actionName: string,
  rootDir: string = process.cwd(),
): PublicActionContract {
  const actionYmlPath = path.join(rootDir, actionName, "action.yml");
  const actionYamlPath = path.join(rootDir, actionName, "action.yaml");

  let filePath: string | undefined;
  if (fs.existsSync(actionYmlPath)) {
    filePath = actionYmlPath;
  } else if (fs.existsSync(actionYamlPath)) {
    filePath = actionYamlPath;
  }

  if (!filePath) {
    throw new Error(
      `Invalid public action contract:\naction: ${actionName}\nproblem: missing action.yml or action.yaml file`,
    );
  }

  const content = fs.readFileSync(filePath, "utf8");
  return parseActionContractYaml(actionName, content);
}

/**
 * Validates all public actions defined in the repository.
 */
export function validateAllPublicActionContracts(
  rootDir: string = process.cwd(),
): Record<PublicActionName, PublicActionContract> {
  const contracts = {} as Record<PublicActionName, PublicActionContract>;
  for (const actionName of PUBLIC_ACTIONS) {
    contracts[actionName] = parseActionContract(actionName, rootDir);
  }
  return contracts;
}

/**
 * Detects breaking API changes between a baseline contract and a target contract.
 */
export function detectBreakingChanges(
  baseline: PublicActionContract,
  target: PublicActionContract,
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  const baselineInputs = new Map(baseline.inputs.map((i) => [i.name, i]));
  const targetInputs = new Map(target.inputs.map((i) => [i.name, i]));

  for (const [inputName, baselineInput] of baselineInputs) {
    const targetInput = targetInputs.get(inputName);
    if (!targetInput) {
      changes.push({
        type: "REMOVED_INPUT",
        input: inputName,
        problem: `Public input "${inputName}" was removed from action "${baseline.action}".`,
      });
      continue;
    }

    if (baselineInput.required !== targetInput.required) {
      changes.push({
        type: "REQUIRED_CHANGED",
        input: inputName,
        problem: `Public input "${inputName}" changed required status from ${baselineInput.required} to ${targetInput.required} in action "${baseline.action}".`,
      });
    }

    if (baselineInput.default !== targetInput.default) {
      changes.push({
        type: "DEFAULT_CHANGED",
        input: inputName,
        problem: `Public input "${inputName}" default value changed from "${baselineInput.default ?? "undefined"}" to "${targetInput.default ?? "undefined"}" in action "${baseline.action}".`,
      });
    }
  }

  const baselineOutputs = new Map(baseline.outputs.map((o) => [o.name, o]));
  const targetOutputs = new Map(target.outputs.map((o) => [o.name, o]));

  for (const [outputName] of baselineOutputs) {
    if (!targetOutputs.has(outputName)) {
      changes.push({
        type: "REMOVED_OUTPUT",
        output: outputName,
        problem: `Public output "${outputName}" was removed from action "${baseline.action}".`,
      });
    }
  }

  return changes;
}
