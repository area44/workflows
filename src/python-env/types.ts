export type PythonPackageManager = "uv" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "pip",
] as const;

export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  ".git",
  ".venv",
  "venv",
  "env",
  ".env",
  "virtualenv",
  ".virtualenv",
  "conda-env",
  ".conda",
  "node_modules",
  "site-packages",
  "__pycache__",
  ".tox",
  ".nox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "dist",
  "build",
  ".egg-info",
  ".next",
  ".astro",
  "out",
  "vendor",
  ".yarn",
] as const;

export interface PythonInstallCommand {
  executable: string;
  args: string[];
}

export interface PythonPackageManagerInfo {
  name: PythonPackageManager;
  lockfile?: string;
  configFile?: string;
  installCommands: PythonInstallCommand[];
  lockCommand?: string;
  syncCommand?: string;
  execPrefix: string;
  isStandalone?: boolean;
}

export interface ResolvedPythonEnvironment {
  detected: boolean;
  packageManager: PythonPackageManagerInfo | null;
  hasSource: boolean;
}

export interface ParsedTomlSuccess {
  success: true;
  data: Record<string, unknown>;
  rawContent?: string;
}

export interface ParsedTomlError {
  success: false;
  error: Error;
}

export type ParsedToml = ParsedTomlSuccess | ParsedTomlError;

export interface PythonProjectContext {
  cwd: string;
  projectDir: string;
  pyprojectToml: ParsedToml | null;
  pyprojectDir?: string;
  workspaceRootToml?: ParsedToml | null;
  workspaceRootDir?: string;
  uvToml: ParsedToml | null;
  uvTomlDir?: string;
  hasUvLock: boolean;
  uvLockDir?: string;
  hasRequirementsTxt: boolean;
  requirementsDir?: string;
  hasSetupPy: boolean;
  setupPyDir?: string;
  hasSetupCfg: boolean;
  setupCfgDir?: string;
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function isValidUvWorkspaceConfig(workspace: unknown): boolean {
  if (!isObject(workspace)) return false;
  if (!Array.isArray(workspace.members) || workspace.members.length === 0) return false;
  return workspace.members.every((m) => typeof m === "string");
}
