import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

import type { ParsedToml } from "./types";

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Parses raw TOML content using smol-toml and explicitly classifies errors.
 */
export function parseToml(content: string): ParsedToml {
  try {
    const data = parse(content);
    if (isObject(data)) {
      return { success: true, data, rawContent: content };
    }
    return {
      success: false,
      error: new Error("Invalid TOML: root must be an object"),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Reads and parses a TOML file from disk.
 * Returns null if the file does not exist, or a ParsedToml result if present.
 */
export function parseTomlFile(filePath: string): ParsedToml | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return parseToml(content);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export function readPyprojectToml(dir: string): ParsedToml | null {
  return parseTomlFile(path.join(dir, "pyproject.toml"));
}

export function readUvToml(dir: string): ParsedToml | null {
  return parseTomlFile(path.join(dir, "uv.toml"));
}
