import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  ActionContract,
  parseActionContract,
  validateAllPublicActionContracts,
} from "../src/action-contract";
import {
  CANONICAL_COMPATIBILITY_MODEL,
  CanonicalCompatibilityModel,
  DEFAULT_BUN_VERSION,
  DEFAULT_NODE_VERSION,
  DEFAULT_NPM_VERSION,
  DEFAULT_PNPM_VERSION,
} from "../src/resolve-environment";

export interface DocumentedMatrixEntry {
  runtime: string;
  packageManager: string;
  supported: boolean;
  isDefault?: boolean;
  reason?: string;
}

export interface DocumentedInput {
  name: string;
  description?: string;
  required: boolean;
  default?: string;
}

export interface DocumentedOutput {
  name: string;
  description?: string;
}

export interface DocumentedActionApi {
  inputs: DocumentedInput[];
  outputs: DocumentedOutput[];
}

interface MatrixHeaderIndices {
  runtimeIdx: number;
  pmIdx: number;
  statusIdx: number;
  defaultIdx: number;
  reasonIdx: number;
}

function parseMatrixHeaderIndices(headers: string[]): MatrixHeaderIndices {
  return {
    runtimeIdx: headers.findIndex((h) => h.includes("runtime")),
    pmIdx: headers.findIndex((h) => h.includes("package manager") || h === "pm"),
    statusIdx: headers.findIndex((h) => h.includes("status") || h.includes("astro") || h.includes("vite")),
    defaultIdx: headers.findIndex((h) => h.includes("default")),
    reasonIdx: headers.findIndex((h) => h.includes("reason") || h.includes("notes") || h.includes("coverage")),
  };
}

function parseMatrixTableRow(
  cells: string[],
  indices: MatrixHeaderIndices,
): DocumentedMatrixEntry | null {
  const { runtimeIdx, pmIdx, statusIdx, defaultIdx, reasonIdx } = indices;
  if (runtimeIdx === -1 || pmIdx === -1) {
    return null;
  }

  const runtime = cells[runtimeIdx]?.replace(/`/g, "").trim().toLowerCase();
  const packageManager = cells[pmIdx]?.replace(/`/g, "").trim().toLowerCase();
  if (!runtime || !packageManager) {
    return null;
  }

  const rawStatus = statusIdx !== -1 ? cells[statusIdx] : "";
  const supported = !/unsupported|not supported/i.test(rawStatus) && /supported/i.test(rawStatus);

  const rawDefault = defaultIdx !== -1 ? cells[defaultIdx] : "";
  const isDefault = /yes|true|default/i.test(rawDefault);

  const reason = reasonIdx !== -1 ? cells[reasonIdx] : undefined;

  return {
    runtime,
    packageManager,
    supported,
    isDefault,
    reason: reason || undefined,
  };
}

function parseMatrixBulletLine(line: string): DocumentedMatrixEntry | null {
  const bulletMatch = line.match(/^[-*]\s*`([^`]+)`\s*\+\s*`([^`]+)`\s*\(([^)]+)\)/);
  if (!bulletMatch) {
    return null;
  }

  const runtime = bulletMatch[1].trim().toLowerCase();
  const packageManager = bulletMatch[2].trim().toLowerCase();
  const details = bulletMatch[3].trim().toLowerCase();

  const supported = details.includes("supported") && !details.includes("unsupported");
  const isDefault = details.includes("default");
  const reasonColon = bulletMatch[3].indexOf(":");
  const reason = reasonColon !== -1 ? bulletMatch[3].slice(reasonColon + 1).trim() : undefined;

  return {
    runtime,
    packageManager,
    supported,
    isDefault,
    reason,
  };
}

export function parseDocumentedCompatibilityMatrix(markdownContent: string): DocumentedMatrixEntry[] {
  const entries: DocumentedMatrixEntry[] = [];
  const lines = markdownContent.split("\n");

  let inMatrixTable = false;
  let indices: MatrixHeaderIndices = {
    runtimeIdx: -1,
    pmIdx: -1,
    statusIdx: -1,
    defaultIdx: -1,
    reasonIdx: -1,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").map((c) => c.trim()).slice(1, -1);
      if (!inMatrixTable) {
        const cleaned = cells.map((c) => c.replace(/`/g, "").trim().toLowerCase());
        const hasRuntimeHeader = cleaned.some((c) => /^runtime(?:\s*\(runtime\))?$/i.test(c));
        const hasPmHeader = cleaned.some((c) => /^package manager(?:\s*\(pm\))?$/i.test(c) || /^pm$/i.test(c));
        if (hasRuntimeHeader && hasPmHeader) {
          inMatrixTable = true;
          indices = parseMatrixHeaderIndices(cleaned);
          continue;
        }
      } else {
        if (cells.every((c) => /^:?-+:?$/.test(c))) {
          continue;
        }
        const entry = parseMatrixTableRow(cells, indices);
        if (entry) {
          entries.push(entry);
        }
      }
    } else {
      inMatrixTable = false;
    }

    const bulletEntry = parseMatrixBulletLine(trimmed);
    if (bulletEntry) {
      entries.push(bulletEntry);
    }
  }

  return entries;
}

export function validateDocumentedCompatibility(
  markdownContent: string,
  model: CanonicalCompatibilityModel = CANONICAL_COMPATIBILITY_MODEL,
): void {
  const entries = parseDocumentedCompatibilityMatrix(markdownContent);
  if (entries.length === 0) {
    throw new Error("No compatibility matrix entries found in documentation.");
  }

  for (const canonical of model.combinations) {
    const matched = entries.find(
      (e) => e.runtime === canonical.runtime && e.packageManager === canonical.packageManager,
    );
    if (!matched) {
      throw new Error(
        `Documentation is missing matrix entry for combination (${canonical.runtime}, ${canonical.packageManager}).`,
      );
    }

    if (matched.supported !== canonical.supported) {
      throw new Error(
        `Documented compatibility mismatch for combination (${canonical.runtime}, ${canonical.packageManager}): expected supported=${canonical.supported}, but documentation states supported=${matched.supported}.`,
      );
    }

    if (canonical.isDefault && !matched.isDefault) {
      throw new Error(
        `Documented default mismatch for combination (${canonical.runtime}, ${canonical.packageManager}): expected default=true, but documentation states default=${Boolean(matched.isDefault)}.`,
      );
    }

    if (!canonical.supported && canonical.reason && matched.reason) {
      const normalizedReason = matched.reason.toLowerCase();
      if (
        !normalizedReason.includes("not supported") &&
        !normalizedReason.includes("unsupported") &&
        !normalizedReason.includes("requires bun or pnpm")
      ) {
        throw new Error(
          `Documented reason mismatch for unsupported combination (${canonical.runtime}, ${canonical.packageManager}): expected reason to describe unsupported status, but documentation states "${matched.reason}".`,
        );
      }
    }
  }

  for (const entry of entries) {
    const isKnownRuntime = model.runtimes.includes(entry.runtime as any);
    const isKnownPm = model.packageManagers.includes(entry.packageManager as any);
    if (!isKnownRuntime || !isKnownPm) {
      throw new Error(
        `Documentation contains unknown matrix entry (${entry.runtime}, ${entry.packageManager}) not defined in canonical compatibility model.`,
      );
    }
  }
}

const KNOWN_ACTIONS_SORTED = ["lint-format", "vite-plus", "astro", "vite"];

function detectActionHeaderMatch(line: string): string | null {
  if (!line.startsWith("#")) {
    return null;
  }
  const normalizedLine = line.toLowerCase().replace(/`/g, "");
  const matched = KNOWN_ACTIONS_SORTED.find((a) => {
    const headerPattern = new RegExp(`(?:^#{1,4}\\s+|area44/)${a}(?:\\b|\\s|\\()`, "i");
    return headerPattern.test(normalizedLine);
  });
  return matched || null;
}

function parseInputTableRow(cells: string[]): DocumentedInput | null {
  if (cells.length < 1) {
    return null;
  }
  const name = cells[0].replace(/`/g, "").trim();
  if (!name || name.toLowerCase() === "name") {
    return null;
  }

  const description = cells.length >= 2 ? cells[1] : undefined;
  const defaultValue = cells.length >= 3 ? cells[2].replace(/`/g, "").trim() : undefined;
  const requiredText = cells.length >= 4 ? cells[3].trim().toLowerCase() : "optional";
  const required = requiredText === "required" || requiredText === "yes" || requiredText === "true";

  return {
    name,
    description,
    required,
    default: defaultValue || undefined,
  };
}

function parseOutputTableRow(cells: string[]): DocumentedOutput | null {
  if (cells.length < 1) {
    return null;
  }
  const name = cells[0].replace(/`/g, "").trim();
  if (!name || name.toLowerCase() === "name") {
    return null;
  }

  const description = cells.length >= 2 ? cells[1] : undefined;
  return {
    name,
    description,
  };
}

export function parseDocumentedActionApi(markdownContent: string, actionKey: string): DocumentedActionApi {
  const inputs: DocumentedInput[] = [];
  const outputs: DocumentedOutput[] = [];

  const lines = markdownContent.split("\n");
  let currentSection: "none" | "inputs" | "outputs" = "none";
  let activeActionMatch = false;

  const normalizedTargetKey = actionKey.toLowerCase().trim();

  const hasMultipleActionHeaders = lines.some((l) => {
    const norm = l.toLowerCase().replace(/`/g, "");
    return KNOWN_ACTIONS_SORTED.some((a) =>
      norm.includes(`### ${a}`) || norm.includes(`## ${a}`) || norm.includes(`area44/${a}`)
    );
  });

  if (!hasMultipleActionHeaders) {
    activeActionMatch = true;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const normalizedLine = trimmed.toLowerCase().replace(/`/g, "");

    const matchedAction = detectActionHeaderMatch(trimmed);
    if (matchedAction) {
      activeActionMatch = matchedAction === normalizedTargetKey;
      if (!activeActionMatch) {
        currentSection = "none";
      }
    }

    if (!activeActionMatch) {
      continue;
    }

    if (/^#{2,4}\s+Inputs/i.test(trimmed)) {
      currentSection = "inputs";
      continue;
    } else if (/^#{2,4}\s+Outputs/i.test(trimmed)) {
      currentSection = "outputs";
      continue;
    } else if (/^#{1,3}\s+/i.test(trimmed) && !/Inputs|Outputs/i.test(trimmed) && !normalizedLine.includes(normalizedTargetKey)) {
      currentSection = "none";
    }

    if ((currentSection === "inputs" || currentSection === "outputs") && trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").map((c) => c.trim()).slice(1, -1);
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (currentSection === "inputs") {
        const inputEntry = parseInputTableRow(cells);
        if (inputEntry) {
          inputs.push(inputEntry);
        }
      } else if (currentSection === "outputs") {
        const outputEntry = parseOutputTableRow(cells);
        if (outputEntry) {
          outputs.push(outputEntry);
        }
      }
    }
  }

  return { inputs, outputs };
}

function validateDocumentedInputs(
  documentedInputs: DocumentedInput[],
  contract: ActionContract,
  targetKey: string,
): void {
  for (const expectedInput of contract.inputs) {
    const matched = documentedInputs.find((i) => i.name === expectedInput.name);
    if (!matched) {
      throw new Error(
        `Public input '${expectedInput.name}' from action.yml is missing in documentation for action '${targetKey}'.`,
      );
    }

    if (matched.required !== expectedInput.required) {
      throw new Error(
        `Required status mismatch for input '${expectedInput.name}' in action '${targetKey}': action.yml specifies required=${expectedInput.required}, but documentation specifies required=${matched.required}.`,
      );
    }

    if (expectedInput.default !== undefined) {
      const expectedDefaultStr = String(expectedInput.default);
      const documentedDefaultStr = matched.default || "";
      if (!documentedDefaultStr.includes(expectedDefaultStr)) {
        throw new Error(
          `Default value mismatch for input '${expectedInput.name}' in action '${targetKey}': action.yml specifies default='${expectedDefaultStr}', but documentation specifies default='${documentedDefaultStr}'.`,
        );
      }
    }
  }

  for (const input of documentedInputs) {
    const exists = contract.inputs.some((i) => i.name === input.name);
    if (!exists) {
      throw new Error(
        `Documentation for action '${targetKey}' contains unknown input '${input.name}' not present in action.yml.`,
      );
    }
  }
}

function validateDocumentedOutputs(
  documentedOutputs: DocumentedOutput[],
  contract: ActionContract,
  targetKey: string,
): void {
  for (const expectedOutput of contract.outputs) {
    const matched = documentedOutputs.find((o) => o.name === expectedOutput.name);
    if (!matched) {
      throw new Error(
        `Public output '${expectedOutput.name}' from action.yml is missing in documentation for action '${targetKey}'.`,
      );
    }
  }

  for (const output of documentedOutputs) {
    const exists = contract.outputs.some((o) => o.name === output.name);
    if (!exists) {
      throw new Error(
        `Documentation for action '${targetKey}' contains unknown output '${output.name}' not present in action.yml.`,
      );
    }
  }
}

export function validateDocumentedActionApi(
  markdownContent: string,
  contract: ActionContract,
  actionKey?: string,
): void {
  const targetKey = actionKey || contract.name.toLowerCase();
  const documented = parseDocumentedActionApi(markdownContent, targetKey);

  if (documented.inputs.length === 0 && contract.inputs.length > 0) {
    throw new Error(`Documentation for action '${targetKey}' is missing inputs section or inputs table.`);
  }

  if (documented.outputs.length === 0 && contract.outputs.length > 0) {
    throw new Error(`Documentation for action '${targetKey}' is missing outputs section or outputs table.`);
  }

  validateDocumentedInputs(documented.inputs, contract, targetKey);
  validateDocumentedOutputs(documented.outputs, contract, targetKey);
}

describe("Documentation Consistency Verification", () => {
  const rootDir = path.resolve(process.cwd());
  const readmeContent = fs.readFileSync(path.join(rootDir, "README.md"), "utf8");
  const compatibilityContent = fs.readFileSync(path.join(rootDir, "COMPATIBILITY.md"), "utf8");
  const docsDir = path.join(rootDir, "docs");

  describe("Documentation Architecture & Navigation", () => {
    it("README.md should exist and contain main entry point usage and action navigation", () => {
      expect(readmeContent).toContain("area44/workflows");
      expect(readmeContent).toContain("Composite Actions");
      expect(readmeContent).toContain("Quick Usage");
      expect(readmeContent).toContain("Public Action API Summary");
      expect(readmeContent).toContain("Compatibility Overview");
      expect(readmeContent).toContain("Documentation Architecture");
    });

    it("README.md should link to COMPATIBILITY.md and all specialized docs files", () => {
      expect(readmeContent).toContain("./COMPATIBILITY.md");
      expect(readmeContent).toContain("./docs/compatibility.md");
      expect(readmeContent).toContain("./docs/versioning.md");
      expect(readmeContent).toContain("./docs/upgrade-guardrails.md");
      expect(readmeContent).toContain("./docs/errors.md");
      expect(readmeContent).toContain("./docs/security.md");
      expect(readmeContent).toContain("./docs/artifacts.md");
    });

    it("all documentation files in docs/ should exist", () => {
      const expectedFiles = [
        "compatibility.md",
        "versioning.md",
        "upgrade-guardrails.md",
        "errors.md",
        "security.md",
        "artifacts.md",
      ];
      for (const file of expectedFiles) {
        expect(fs.existsSync(path.join(docsDir, file))).toBe(true);
      }
    });

    it("documentation section headings across all markdown files should not use numerical prefixes", () => {
      const docFiles = [
        path.join(rootDir, "README.md"),
        path.join(rootDir, "COMPATIBILITY.md"),
        path.join(rootDir, "astro/README.md"),
        path.join(rootDir, "vite/README.md"),
        path.join(rootDir, "vite-plus/README.md"),
        path.join(rootDir, "lint-format/README.md"),
        ...fs.readdirSync(docsDir).map((f) => path.join(docsDir, f)),
      ];

      const numericalHeadingRegex = /^#{1,6}\s+\d+[\.\)]\s+/m;
      for (const filePath of docFiles) {
        const content = fs.readFileSync(filePath, "utf8");
        expect(content).not.toMatch(numericalHeadingRegex);
      }
    });
  });

  describe("Semantic Public Action API Contract Consistency", () => {
    validateAllPublicActionContracts(rootDir);

    it.each(["astro", "vite", "vite-plus", "lint-format"] as const)(
      "action '%s' README.md and root README.md should match action.yml semantically",
      (actionName) => {
        const actionReadmePath = path.join(rootDir, actionName, "README.md");
        const actionContract = parseActionContract(actionName, rootDir);
        const actionReadme = fs.readFileSync(actionReadmePath, "utf8");

        validateDocumentedActionApi(actionReadme, actionContract, actionName);
        validateDocumentedActionApi(readmeContent, actionContract, actionName);
      },
    );
  });

  describe("Semantic Compatibility Documentation Consistency", () => {
    const docCompatContent = fs.readFileSync(path.join(docsDir, "compatibility.md"), "utf8");

    it("COMPATIBILITY.md and docs/compatibility.md should semantically match CANONICAL_COMPATIBILITY_MODEL", () => {
      validateDocumentedCompatibility(compatibilityContent, CANONICAL_COMPATIBILITY_MODEL);
      validateDocumentedCompatibility(docCompatContent, CANONICAL_COMPATIBILITY_MODEL);
    });

    it("should accurately document canonical default versions", () => {
      expect(docCompatContent).toContain(DEFAULT_NODE_VERSION);
      expect(docCompatContent).toContain(DEFAULT_BUN_VERSION);
      expect(docCompatContent).toContain(DEFAULT_NPM_VERSION);
      expect(docCompatContent).toContain(DEFAULT_PNPM_VERSION);

      expect(compatibilityContent).toContain(DEFAULT_NODE_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_BUN_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_NPM_VERSION);
      expect(compatibilityContent).toContain(DEFAULT_PNPM_VERSION);
    });
  });

  describe("Versioning Documentation Consistency", () => {
    const docVersioningContent = fs.readFileSync(path.join(docsDir, "versioning.md"), "utf8");

    it("should document package.json as authoritative source of truth", () => {
      expect(docVersioningContent).toContain("package.json");
      expect(docVersioningContent.toLowerCase()).toContain("authoritative");

      expect(compatibilityContent).toContain("package.json");
      expect(compatibilityContent.toLowerCase()).toContain("authoritative");
    });

    it("should document SemVer change impact categories (patch, minor, major)", () => {
      expect(docVersioningContent).toContain("Patch Releases");
      expect(docVersioningContent).toContain("Minor Releases");
      expect(docVersioningContent).toContain("Major Releases");
    });
  });

  describe("Upgrade Guardrails Documentation Consistency", () => {
    const docGuardrailsContent = fs.readFileSync(
      path.join(docsDir, "upgrade-guardrails.md"),
      "utf8",
    );

    it("should document baseline resolution candidate chain", () => {
      const requiredRefs = [
        "baseRef",
        "UPGRADE_BASE_REF",
        "BASE_REF",
        "GITHUB_BASE_REF",
        "GITHUB_EVENT_BEFORE",
        "origin/main",
        "main",
      ];
      for (const ref of requiredRefs) {
        expect(docGuardrailsContent).toContain(ref);
      }
    });

    it("should explicitly prohibit contract guessing via HEAD~1", () => {
      expect(docGuardrailsContent).toContain("HEAD~1");
      expect(docGuardrailsContent.toLowerCase()).toContain("prohibited");
    });
  });

  describe("Error, Security & Artifact Integrity Documentation Consistency", () => {
    it("docs/errors.md should document all WorkflowErrorCode enum values", () => {
      const docErrorsContent = fs.readFileSync(path.join(docsDir, "errors.md"), "utf8");
      const codes = [
        "INVALID_INPUT",
        "UNSUPPORTED_RUNTIME_OR_PM",
        "UNSUPPORTED_COMBINATION",
        "MISSING_CONFIGURATION",
        "SETUP_FAILURE",
        "COMMAND_EXECUTION_FAILURE",
      ];
      for (const code of codes) {
        expect(docErrorsContent).toContain(code);
      }
    });

    it("docs/security.md should document command tokenization and credential sanitization", () => {
      const docSecurityContent = fs.readFileSync(path.join(docsDir, "security.md"), "utf8");
      expect(docSecurityContent).toContain("sanitizeCommandString");
      expect(docSecurityContent.toLowerCase()).toContain("subshell");
    });

    it("docs/artifacts.md should document source to dist build policy and verification command", () => {
      const docArtifactsContent = fs.readFileSync(path.join(docsDir, "artifacts.md"), "utf8");
      expect(docArtifactsContent).toContain("npm run build");
      expect(docArtifactsContent).toContain("npm run verify:artifacts");
      expect(docArtifactsContent).toContain("src/");
      expect(docArtifactsContent).toContain("dist/");
    });
  });

  describe("Negative Regression Verification (Fails on Contradictory Documentation)", () => {
    describe("Compatibility Validation Regressions", () => {
      it("should fail when a supported combination is documented as unsupported", () => {
        const badDoc = `
| Runtime | Package Manager | Status | Default |
| \`node\` | \`npm\` | Unsupported | Yes |
| \`node\` | \`pnpm\` | Supported | No |
| \`node\` | \`bun\` | Supported | No |
| \`bun\` | \`bun\` | Supported | No |
| \`bun\` | \`pnpm\` | Supported | No |
| \`bun\` | \`npm\` | Unsupported | No |
`;
        expect(() => validateDocumentedCompatibility(badDoc)).toThrow(
          /expected supported=true, but documentation states supported=false/,
        );
      });

      it("should fail when an unsupported combination (bun + npm) is documented as supported", () => {
        const badDoc = `
| Runtime | Package Manager | Status | Default |
| \`node\` | \`npm\` | Supported | Yes |
| \`node\` | \`pnpm\` | Supported | No |
| \`node\` | \`bun\` | Supported | No |
| \`bun\` | \`bun\` | Supported | No |
| \`bun\` | \`pnpm\` | Supported | No |
| \`bun\` | \`npm\` | Supported | No |
`;
        expect(() => validateDocumentedCompatibility(badDoc)).toThrow(
          /expected supported=false, but documentation states supported=true/,
        );
      });

      it("should fail when default combination is documented without default status", () => {
        const badDoc = `
| Runtime | Package Manager | Status | Default |
| \`node\` | \`npm\` | Supported | No |
| \`node\` | \`pnpm\` | Supported | No |
| \`node\` | \`bun\` | Supported | No |
| \`bun\` | \`bun\` | Supported | No |
| \`bun\` | \`pnpm\` | Supported | No |
| \`bun\` | \`npm\` | Unsupported | No |
`;
        expect(() => validateDocumentedCompatibility(badDoc)).toThrow(
          /expected default=true, but documentation states default=false/,
        );
      });

      it("should fail when documentation contains unknown/extra matrix combination", () => {
        const badDoc = `
| Runtime | Package Manager | Status | Default |
| \`node\` | \`npm\` | Supported | Yes |
| \`node\` | \`pnpm\` | Supported | No |
| \`node\` | \`bun\` | Supported | No |
| \`bun\` | \`bun\` | Supported | No |
| \`bun\` | \`pnpm\` | Supported | No |
| \`bun\` | \`npm\` | Unsupported | No |
| \`deno\` | \`npm\` | Supported | No |
`;
        expect(() => validateDocumentedCompatibility(badDoc)).toThrow(
          /Documentation contains unknown matrix entry \(deno, npm\)/,
        );
      });

      it("should fail when canonical compatibility model changes and documentation drifts", () => {
        const driftedModel: CanonicalCompatibilityModel = {
          ...CANONICAL_COMPATIBILITY_MODEL,
          combinations: CANONICAL_COMPATIBILITY_MODEL.combinations.map((c) =>
            c.runtime === "bun" && c.packageManager === "npm"
              ? { ...c, supported: true }
              : c,
          ),
        };

        const currentValidDoc = `
| Runtime | Package Manager | Status | Default |
| \`node\` | \`npm\` | Supported | Yes |
| \`node\` | \`pnpm\` | Supported | No |
| \`node\` | \`bun\` | Supported | No |
| \`bun\` | \`bun\` | Supported | No |
| \`bun\` | \`pnpm\` | Supported | No |
| \`bun\` | \`npm\` | Unsupported | No |
`;

        expect(() => validateDocumentedCompatibility(currentValidDoc, driftedModel)).toThrow(
          /expected supported=true, but documentation states supported=false/,
        );
      });
    });

    describe("Public API Validation Regressions", () => {
      const mockContract: ActionContract = {
        name: "astro",
        inputs: [
          { name: "path", required: false, default: "dist" },
          { name: "runtime", required: false },
        ],
        outputs: [{ name: "runtime" }],
      };

      it("should fail when an optional input is documented as required", () => {
        const badDoc = `
### \`astro\`

#### Inputs

| Name | Description | Default | Required |
| \`path\` | Site path | \`dist\` | Required |
| \`runtime\` | Runtime override | | Optional |

#### Outputs

| Name | Description |
| \`runtime\` | Resolved runtime |
`;
        expect(() => validateDocumentedActionApi(badDoc, mockContract, "astro")).toThrow(
          /action.yml specifies required=false, but documentation specifies required=true/,
        );
      });

      it("should fail when a required input is documented as optional", () => {
        const mockRequiredContract: ActionContract = {
          name: "astro",
          inputs: [{ name: "token", required: true }],
          outputs: [],
        };
        const badDoc = `
### \`astro\`

#### Inputs

| Name | Description | Default | Required |
| \`token\` | Secret token | | Optional |

#### Outputs
`;
        expect(() => validateDocumentedActionApi(badDoc, mockRequiredContract, "astro")).toThrow(
          /action.yml specifies required=true, but documentation specifies required=false/,
        );
      });

      it("should fail when an input default value is documented incorrectly", () => {
        const badDoc = `
### \`astro\`

#### Inputs

| Name | Description | Default | Required |
| \`path\` | Site path | \`build\` | Optional |
| \`runtime\` | Runtime override | | Optional |

#### Outputs

| Name | Description |
| \`runtime\` | Resolved runtime |
`;
        expect(() => validateDocumentedActionApi(badDoc, mockContract, "astro")).toThrow(
          /action.yml specifies default='dist', but documentation specifies default='build'/,
        );
      });

      it("should fail when a public input or output from action.yml is missing in documentation", () => {
        const missingInputDoc = `
### \`astro\`

#### Inputs

| Name | Description | Default | Required |
| \`path\` | Site path | \`dist\` | Optional |

#### Outputs

| Name | Description |
| \`runtime\` | Resolved runtime |
`;
        expect(() => validateDocumentedActionApi(missingInputDoc, mockContract, "astro")).toThrow(
          /Public input 'runtime' from action.yml is missing in documentation/,
        );
      });

      it("should fail when documentation contains phantom input not present in action.yml", () => {
        const extraInputDoc = `
### \`astro\`

#### Inputs

| Name | Description | Default | Required |
| \`path\` | Site path | \`dist\` | Optional |
| \`runtime\` | Runtime override | | Optional |
| \`phantom\` | Phantom option | | Optional |

#### Outputs

| Name | Description |
| \`runtime\` | Resolved runtime |
`;
        expect(() => validateDocumentedActionApi(extraInputDoc, mockContract, "astro")).toThrow(
          /Documentation for action 'astro' contains unknown input 'phantom' not present in action.yml/,
        );
      });
    });
  });
});
