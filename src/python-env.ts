import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

export type PythonPackageManager = "uv" | "pip";

export const PYTHON_PACKAGE_MANAGER_PRIORITY: readonly PythonPackageManager[] = [
  "uv",
  "pip",
] as const;

export const DEFAULT_PYTHON_VERSION = "3.12";
export const DEFAULT_UV_VERSION = "0.6";
export const DEFAULT_PIP_VERSION = "24.0";

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
  version?: string;
  versionSource?: "detected" | "default";
  lockfile?: string;
  configFile?: string;
  installCommands: PythonInstallCommand[];
  lockCommand?: string;
  syncCommand?: string;
  execPrefix: string;
  isStandalone?: boolean;
}

export function getVerifiedUvVersion(): string | undefined {
  try {
    const output = child_process
      .execFileSync("uv", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      })
      .trim();
    const match = output.match(/^uv\s+(\d+\.\d+\.\d+(?:-[a-z0-9_.-]+)?)/i);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export function getVerifiedPipVersion(): string | undefined {
  try {
    const output = child_process
      .execFileSync("pip", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      })
      .trim();
    const match = output.match(/^pip\s+(\d+\.\d+(?:\.\d+)?)/i);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolvedPythonEnvironment {
  detected: boolean;
  version: string;
  packageManager: PythonPackageManagerInfo | null;
  ruffVersion: string;
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
 * Reads and parses uv.toml in cwd using parseToml.
 * Returns null if file does not exist, or ParsedToml result if file exists.
 */
export function readUvToml(cwd: string = process.cwd()): ParsedToml | null {
  const uvTomlPath = path.join(cwd, "uv.toml");
  if (!fs.existsSync(uvTomlPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(uvTomlPath, "utf8");
    return parseToml(content);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Reads and parses pyproject.toml in cwd using parseToml.
 * Returns null if file does not exist, or ParsedToml result if file exists.
 */
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
  pythonVersionFile?: string;
  runtimeTxtFile?: string;
}

/**
 * Traverses directories from cwd up to the repository root (stopping at .git or filesystem root)
 * to gather Python project configuration, manifests, and lockfiles across parent directories and workspace roots.
 */
function collectParentDirs(resolvedCwd: string): string[] {
  const dirs: string[] = [];
  let curr = resolvedCwd;

  while (true) {
    dirs.push(curr);
    if (fs.existsSync(path.join(curr, ".git"))) {
      break;
    }
    const parent = path.dirname(curr);
    if (parent === curr) {
      break;
    }
    curr = parent;
  }
  return dirs;
}

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || normalized === "") {
    return /^$/;
  }
  let regexStr = "^";
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i++;
      continue;
    }
    if (char === "?") {
      regexStr += "[^/]";
      i++;
      continue;
    }
    if ("./+^$()|[]{}\\".includes(char)) {
      regexStr += "\\" + char;
      i++;
      continue;
    }
    regexStr += char;
    i++;
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

export function isDirectoryMatchedByGlobs(relPath: string, globs: string[]): boolean {
  let normRelPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normRelPath === ".") {
    normRelPath = "";
  }
  for (const glob of globs) {
    if (globToRegex(glob).test(normRelPath)) {
      return true;
    }
  }
  return false;
}

export function isValidUvWorkspaceConfig(workspace: unknown): boolean {
  if (!isObject(workspace)) return false;
  if (!Array.isArray(workspace.members) || workspace.members.length === 0) return false;
  return workspace.members.every((m) => typeof m === "string");
}

export function isWorkspaceMember(
  wsRootDir: string,
  childDir: string,
  workspaceConfig: Record<string, unknown>,
): boolean {
  const resolvedWsRoot = path.resolve(wsRootDir);
  const resolvedChild = path.resolve(childDir);
  const relPath = path.relative(resolvedWsRoot, resolvedChild).replace(/\\/g, "/");

  if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
    return false;
  }

  const members = Array.isArray(workspaceConfig.members)
    ? workspaceConfig.members.filter((m): m is string => typeof m === "string")
    : [];

  const excludes = Array.isArray(workspaceConfig.exclude)
    ? workspaceConfig.exclude.filter((e): e is string => typeof e === "string")
    : [];

  const effectiveRelPath = relPath === "" ? "." : relPath;

  if (excludes.length > 0 && isDirectoryMatchedByGlobs(effectiveRelPath, excludes)) {
    return false;
  }

  if (!isDirectoryMatchedByGlobs(effectiveRelPath, members)) {
    return false;
  }

  if (resolvedChild !== resolvedWsRoot) {
    if (!fs.existsSync(path.join(resolvedChild, "pyproject.toml"))) {
      return false;
    }
  }

  return true;
}

function getWorkspaceConfigInDir(
  dir: string,
): { dir: string; toml: ParsedToml; config: Record<string, unknown> } | null {
  const pyproject = readPyprojectToml(dir);
  if (
    pyproject?.success === true &&
    isObject(pyproject.data.tool) &&
    isObject((pyproject.data.tool as Record<string, unknown>).uv) &&
    isValidUvWorkspaceConfig(
      ((pyproject.data.tool as Record<string, unknown>).uv as Record<string, unknown>).workspace,
    )
  ) {
    return {
      dir,
      toml: pyproject,
      config: ((pyproject.data.tool as Record<string, unknown>).uv as Record<string, unknown>)
        .workspace as Record<string, unknown>,
    };
  }
  return null;
}

function findWorkspaceRootContext(
  dirs: string[],
  childDir: string,
  startIndex: number = 0,
): { dir?: string; toml?: ParsedToml | null } {
  for (let i = startIndex; i < dirs.length; i++) {
    const parentDir = dirs[i];
    const wsInfo = getWorkspaceConfigInDir(parentDir);
    if (wsInfo && isWorkspaceMember(parentDir, childDir, wsInfo.config)) {
      return { dir: parentDir, toml: wsInfo.toml };
    }
  }
  return {};
}

function resolveUvLockDir(
  dirs: string[],
  childDir: string,
  pyprojectDir?: string,
): string | undefined {
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, "uv.lock"))) {
      if (dir === childDir || (pyprojectDir && dir === pyprojectDir)) {
        return dir;
      }
      const ws = findWorkspaceRootContext(dirs, childDir);
      if (ws.dir === dir) {
        return dir;
      }
    }
  }
  return undefined;
}

function findFirstExistingPath(dirs: string[], filename: string): string | undefined {
  for (const dir of dirs) {
    const target = path.join(dir, filename);
    if (fs.existsSync(target)) {
      return target;
    }
  }
  return undefined;
}

function hasOwnManifestFiles(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "pyproject.toml")) ||
    fs.existsSync(path.join(dir, "requirements.txt")) ||
    fs.existsSync(path.join(dir, "setup.py")) ||
    fs.existsSync(path.join(dir, "setup.cfg")) ||
    fs.existsSync(path.join(dir, "uv.lock"))
  );
}

function findSelfManifestContext(resolvedCwd: string, dirs: string[]): PythonProjectContext | null {
  if (!hasOwnManifestFiles(resolvedCwd)) {
    return null;
  }

  const pyprojectToml = readPyprojectToml(resolvedCwd);
  const pyprojectDir = pyprojectToml ? resolvedCwd : undefined;
  const ws = findWorkspaceRootContext(dirs, resolvedCwd, 1);

  const allowedDirs = ws.dir ? dirs.slice(0, dirs.indexOf(ws.dir) + 1) : [resolvedCwd];

  const uvTomlPath = findFirstExistingPath(allowedDirs, "uv.toml");
  const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;
  const uvLockDir = resolveUvLockDir(dirs, resolvedCwd, pyprojectDir);

  const hasRequirementsTxt = fs.existsSync(path.join(resolvedCwd, "requirements.txt"));
  const hasSetupPy = fs.existsSync(path.join(resolvedCwd, "setup.py"));
  const hasSetupCfg = fs.existsSync(path.join(resolvedCwd, "setup.cfg"));

  return {
    cwd: resolvedCwd,
    projectDir: resolvedCwd,
    pyprojectToml,
    pyprojectDir,
    workspaceRootToml: ws.toml,
    workspaceRootDir: ws.dir,
    uvToml,
    uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
    hasUvLock: Boolean(uvLockDir),
    uvLockDir,
    hasRequirementsTxt,
    requirementsDir: hasRequirementsTxt ? resolvedCwd : undefined,
    hasSetupPy,
    setupPyDir: hasSetupPy ? resolvedCwd : undefined,
    hasSetupCfg,
    setupCfgDir: hasSetupCfg ? resolvedCwd : undefined,
    pythonVersionFile: findFirstExistingPath(allowedDirs, ".python-version"),
    runtimeTxtFile: findFirstExistingPath(allowedDirs, "runtime.txt"),
  };
}

function parseTomlFile(filePath: string): ParsedToml | null {
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

function findAncestorManifestContext(resolvedCwd: string, dirs: string[]): PythonProjectContext {
  for (let i = 1; i < dirs.length; i++) {
    const pDir = dirs[i];
    if (hasOwnManifestFiles(pDir)) {
      const pyprojectToml = readPyprojectToml(pDir);
      const pyprojectDir = pyprojectToml ? pDir : undefined;
      const ws = findWorkspaceRootContext(dirs, pDir, i + 1);

      const allowedDirs = ws.dir ? dirs.slice(0, dirs.indexOf(ws.dir) + 1) : dirs.slice(0, i + 1);

      const uvTomlPath = findFirstExistingPath(allowedDirs, "uv.toml");
      const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;
      const uvLockDir = resolveUvLockDir(dirs.slice(i), pDir, pyprojectDir);
      const hasRequirementsTxt = fs.existsSync(path.join(pDir, "requirements.txt"));
      const hasSetupPy = fs.existsSync(path.join(pDir, "setup.py"));
      const hasSetupCfg = fs.existsSync(path.join(pDir, "setup.cfg"));

      return {
        cwd: resolvedCwd,
        projectDir: pDir,
        pyprojectToml,
        pyprojectDir,
        workspaceRootToml: ws.toml,
        workspaceRootDir: ws.dir,
        uvToml,
        uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
        hasUvLock: Boolean(uvLockDir),
        uvLockDir,
        hasRequirementsTxt,
        requirementsDir: hasRequirementsTxt ? pDir : undefined,
        hasSetupPy,
        setupPyDir: hasSetupPy ? pDir : undefined,
        hasSetupCfg,
        setupCfgDir: hasSetupCfg ? pDir : undefined,
        pythonVersionFile: findFirstExistingPath(allowedDirs, ".python-version"),
        runtimeTxtFile: findFirstExistingPath(allowedDirs, "runtime.txt"),
      };
    }
  }

  const uvTomlPath = findFirstExistingPath(dirs, "uv.toml");
  const uvToml = uvTomlPath ? parseTomlFile(uvTomlPath) : null;

  return {
    cwd: resolvedCwd,
    projectDir: resolvedCwd,
    pyprojectToml: null,
    uvToml,
    uvTomlDir: uvTomlPath ? path.dirname(uvTomlPath) : undefined,
    hasUvLock: false,
    hasRequirementsTxt: false,
    hasSetupPy: false,
    hasSetupCfg: false,
    pythonVersionFile: findFirstExistingPath(dirs, ".python-version"),
    runtimeTxtFile: findFirstExistingPath(dirs, "runtime.txt"),
  };
}

/**
 * Traverses directories from cwd up to the repository root (stopping at .git or filesystem root)
 * to gather Python project configuration, manifests, and lockfiles across parent directories and workspace roots.
 */
export function findPythonProjectContext(cwd: string = process.cwd()): PythonProjectContext {
  const resolvedCwd = path.resolve(cwd);
  const dirs = collectParentDirs(resolvedCwd);
  const selfCtx = findSelfManifestContext(resolvedCwd, dirs);
  if (selfCtx) {
    return selfCtx;
  }
  return findAncestorManifestContext(resolvedCwd, dirs);
}

export function readPyprojectToml(cwd: string = process.cwd()): ParsedToml | null {
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (!fs.existsSync(pyprojectPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(pyprojectPath, "utf8");
    return parseToml(content);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export function parsePythonVersionFromConstraint(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^python-?/i, "")
    .replace(/['"]/g, "");
  const match = cleaned.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : undefined;
}

function readPyprojectPythonVersion(
  cwd: string,
  pyprojectToml?: ParsedToml | null,
): string | undefined {
  const parsed = pyprojectToml !== undefined ? pyprojectToml : readPyprojectToml(cwd);
  if (parsed?.success !== true) return undefined;
  const project = parsed.data.project;
  if (isObject(project) && typeof project["requires-python"] === "string") {
    return parsePythonVersionFromConstraint(project["requires-python"]);
  }
  return undefined;
}

/**
 * Resolves the target Python version from project configuration files (.python-version,
 * pyproject.toml, runtime.txt) or falls back to DEFAULT_PYTHON_VERSION.
 */
function readVersionFromFile(filePath: string | undefined): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  try {
    const content = fs.readFileSync(filePath, "utf8").trim();
    return parsePythonVersionFromConstraint(content);
  } catch {
    return undefined;
  }
}

/**
 * Resolves the target Python version from project configuration files (.python-version,
 * pyproject.toml, runtime.txt) or falls back to DEFAULT_PYTHON_VERSION.
 */
export function resolvePythonVersion(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): string {
  const ctx = findPythonProjectContext(cwd);
  const pyproject =
    pyprojectToml !== undefined && pyprojectToml !== null ? pyprojectToml : ctx.pyprojectToml;

  // 1. Local .python-version in projectDir
  const localPyVer = readVersionFromFile(path.join(ctx.projectDir, ".python-version"));
  if (localPyVer) {
    return localPyVer;
  }

  // 2. Local pyproject.toml requires-python in projectDir
  const pyprojectVer = readPyprojectPythonVersion(ctx.projectDir, pyproject);
  if (pyprojectVer) {
    return pyprojectVer;
  }

  // 3. Local runtime.txt in projectDir
  const localRuntimeVer = readVersionFromFile(path.join(ctx.projectDir, "runtime.txt"));
  if (localRuntimeVer) {
    return localRuntimeVer;
  }

  // 4. Workspace root pyproject.toml requires-python
  if (ctx.workspaceRootToml) {
    const wsVer = readPyprojectPythonVersion(ctx.workspaceRootDir || cwd, ctx.workspaceRootToml);
    if (wsVer) {
      return wsVer;
    }
  }

  // 5. Ancestor .python-version
  const ancestorPyVer = readVersionFromFile(ctx.pythonVersionFile);
  if (ancestorPyVer) {
    return ancestorPyVer;
  }

  // 6. Ancestor runtime.txt
  const ancestorRuntimeVer = readVersionFromFile(ctx.runtimeTxtFile);
  if (ancestorRuntimeVer) {
    return ancestorRuntimeVer;
  }

  // When a Python project is detected but no version is explicitly configured,
  // resolve to the latest stable Python version supported by the action.
  if (hasPythonProject(cwd)) {
    return DEFAULT_PYTHON_VERSION;
  }

  return "";
}

/**
 * Recursively checks if directory contains Python source files (.py or .pyi),
 * while skipping excluded dependency, cache, and build directories.
 */
export function hasPythonSource(
  cwd: string = process.cwd(),
  excludedDirs: readonly string[] = DEFAULT_EXCLUDED_DIRS,
): boolean {
  if (!fs.existsSync(cwd)) {
    return false;
  }

  const stack: string[] = [cwd];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      if (entry.isDirectory()) {
        if (excludedDirs.includes(name) || name.endsWith(".egg-info")) {
          continue;
        }
        stack.push(path.join(currentDir, name));
      } else if (entry.isFile()) {
        if (name.endsWith(".py") || name.endsWith(".pyi")) {
          return true;
        }
      }
    }
  }

  return false;
}

function stripComment(raw: string, startIdx: number, len: number): [string, number] {
  let res = "";
  let i = startIdx;
  while (i < len && raw[i] !== "\n" && raw[i] !== "\r") {
    res += " ";
    i++;
  }
  return [res, i];
}

function stripMultilineBasicString(raw: string, startIdx: number, len: number): [string, number] {
  let res = "   ";
  let i = startIdx + 3;

  while (i < len) {
    if (raw.slice(i, i + 3) === '"""') {
      let backslashCount = 0;
      let k = i - 1;
      while (k >= startIdx + 3 && raw[k] === "\\") {
        backslashCount++;
        k--;
      }
      if (backslashCount % 2 === 0) {
        res += "   ";
        return [res, i + 3];
      }
    }

    res += raw[i] === "\n" ? "\n" : " ";
    i++;
  }

  return [res, i];
}

function stripMultilineLiteralString(raw: string, startIdx: number, len: number): [string, number] {
  let res = "   ";
  let i = startIdx + 3;
  while (i < len && raw.slice(i, i + 3) !== "'''") {
    res += raw[i] === "\n" ? "\n" : " ";
    i++;
  }
  if (i < len) {
    res += "   ";
    i += 3;
  }
  return [res, i];
}

function stripSinglelineBasicString(raw: string, startIdx: number, len: number): [string, number] {
  let res = " ";
  let i = startIdx + 1;

  while (i < len && raw[i] !== "\n" && raw[i] !== "\r") {
    if (raw[i] === '"') {
      let backslashCount = 0;
      let k = i - 1;
      while (k >= startIdx + 1 && raw[k] === "\\") {
        backslashCount++;
        k--;
      }
      if (backslashCount % 2 === 0) {
        res += " ";
        return [res, i + 1];
      }
    }
    res += " ";
    i++;
  }

  return [res, i];
}

function stripSinglelineLiteralString(
  raw: string,
  startIdx: number,
  len: number,
): [string, number] {
  let res = " ";
  let i = startIdx + 1;
  while (i < len && raw[i] !== "'" && raw[i] !== "\n" && raw[i] !== "\r") {
    res += " ";
    i++;
  }
  if (i < len && raw[i] === "'") {
    res += " ";
    i++;
  }
  return [res, i];
}

/**
 * Strips comments and all TOML string literals (single-line basic/literal,
 * multiline basic/literal) from raw TOML text, replacing their characters with spaces.
 * This guarantees table headers like [project] inside multiline strings or comments
 * are ignored when checking for actual TOML headers.
 */
export function stripTomlStringsAndComments(raw: string): string {
  let result = "";
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];

    if (ch === "#") {
      const [chunk, nextI] = stripComment(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (raw.slice(i, i + 3) === '"""') {
      const [chunk, nextI] = stripMultilineBasicString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (raw.slice(i, i + 3) === "'''") {
      const [chunk, nextI] = stripMultilineLiteralString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (ch === '"') {
      const [chunk, nextI] = stripSinglelineBasicString(raw, i, len);
      result += chunk;
      i = nextI;
    } else if (ch === "'") {
      const [chunk, nextI] = stripSinglelineLiteralString(raw, i, len);
      result += chunk;
      i = nextI;
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

/**
 * Checks whether an explicit [project] table header is declared in pyproject.toml.
 *
 * In production paths (`readPyprojectToml` / `parseToml`), `rawContent` is attached to
 * `ParsedTomlSuccess`, allowing authoritative verification of the explicit table header in stripped TOML.
 *
 * Fallback when `rawContent` is absent (synthetic test objects):
 * Checks if `parsed.project` is empty or contains non-object primitive/array values.
 */
function hasProjectTable(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (!isObject(parsed.project)) return false;

  if (typeof rawContent === "string") {
    const stripped = stripTomlStringsAndComments(rawContent);
    return /(?:^|\n)\s*\[\s*project\s*\]\s*(?:\n|$)/.test(stripped);
  }

  const entries = Object.entries(parsed.project);
  if (entries.length === 0) return true;
  return entries.some(([, val]) => !isObject(val));
}

/**
 * Checks whether an explicit [build-system] table header is declared in pyproject.toml.
 */
function hasBuildSystemTable(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (!isObject(parsed["build-system"])) return false;

  if (typeof rawContent === "string") {
    const stripped = stripTomlStringsAndComments(rawContent);
    return /(?:^|\n)\s*\[\s*build-system\s*\]\s*(?:\n|$)/.test(stripped);
  }

  const entries = Object.entries(parsed["build-system"]);
  if (entries.length === 0) return true;
  return entries.some(([, val]) => !isObject(val));
}

function isUvProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  if (hasProjectTable(parsed, rawContent) || hasBuildSystemTable(parsed, rawContent)) {
    return true;
  }
  if (isObject(parsed.tool) && isObject(parsed.tool.uv)) {
    const uv = parsed.tool.uv as Record<string, unknown>;
    return isValidUvWorkspaceConfig(uv.workspace) || Array.isArray(uv["dev-dependencies"]);
  }
  return false;
}

function isUvToolConfigPresent(parsed: Record<string, unknown>): boolean {
  return isObject(parsed.tool) && isObject((parsed.tool as Record<string, unknown>).uv);
}

function isPipProjectConfigPresent(parsed: Record<string, unknown>, rawContent?: string): boolean {
  return hasProjectTable(parsed, rawContent) || hasBuildSystemTable(parsed, rawContent);
}

function getRelativePath(fromDir: string, toPath: string): string {
  const rel = path.relative(fromDir, toPath);
  if (!rel) return ".";
  return rel;
}

function checkUvLockedProject(
  ctx: PythonProjectContext,
  hasValidPyproject: boolean,
): PythonPackageManagerInfo {
  if (!hasValidPyproject) {
    throw new Error(
      "Invalid Python project configuration: 'uv.lock' was detected without a valid 'pyproject.toml' project or workspace configuration ('[project]', '[build-system]', or '[tool.uv.workspace]'). 'uv sync' requires a valid 'pyproject.toml' file.",
    );
  }
  return {
    name: "uv",
    lockfile: "uv.lock",
    configFile: "pyproject.toml",
    installCommands: [{ executable: "uv", args: ["sync"] }],
    lockCommand: "uv lock",
    syncCommand: "uv sync",
    execPrefix: "uv run",
  };
}

function checkUvUnlockedProject(
  ctx: PythonProjectContext,
  hasValidPyproject: boolean,
): PythonPackageManagerInfo | null {
  if (ctx.hasRequirementsTxt && ctx.requirementsDir) {
    const reqPathRel = getRelativePath(ctx.cwd, path.join(ctx.requirementsDir, "requirements.txt"));
    return {
      name: "uv",
      configFile: ctx.pyprojectDir ? "pyproject.toml" : "uv.toml",
      installCommands: [{ executable: "uv", args: ["pip", "install", "-r", reqPathRel] }],
      execPrefix: "uv run",
    };
  }

  if (hasValidPyproject) {
    return {
      name: "uv",
      configFile: ctx.pyprojectDir ? "pyproject.toml" : "uv.toml",
      installCommands: [{ executable: "uv", args: ["sync"] }],
      lockCommand: "uv lock",
      syncCommand: "uv sync",
      execPrefix: "uv run",
    };
  }

  return null;
}

function detectUvFromContext(ctx: PythonProjectContext): PythonPackageManagerInfo | null {
  const localPyprojectValid =
    ctx.pyprojectToml?.success === true &&
    isUvProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent);

  const workspacePyprojectValid =
    ctx.workspaceRootToml?.success === true &&
    isUvProjectConfigPresent(ctx.workspaceRootToml.data, ctx.workspaceRootToml.rawContent);

  const hasValidPyproject = localPyprojectValid || workspacePyprojectValid;

  const hasUvToml = ctx.uvToml?.success === true;
  const hasUvToolConfig =
    (ctx.pyprojectToml?.success === true && isUvToolConfigPresent(ctx.pyprojectToml.data)) ||
    (ctx.workspaceRootToml?.success === true && isUvToolConfigPresent(ctx.workspaceRootToml.data));

  if (ctx.hasUvLock) {
    return checkUvLockedProject(ctx, hasValidPyproject);
  }

  if (hasUvToolConfig || hasUvToml) {
    return checkUvUnlockedProject(ctx, hasValidPyproject);
  }

  return null;
}

function detectPipFromContext(ctx: PythonProjectContext): PythonPackageManagerInfo | null {
  const hasProjectOrBuildSystem =
    ctx.pyprojectToml?.success === true &&
    isPipProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent);

  const isPipProject =
    ctx.hasRequirementsTxt || ctx.hasSetupPy || ctx.hasSetupCfg || hasProjectOrBuildSystem;
  if (!isPipProject) return null;

  let configFile: string | undefined;
  if (hasProjectOrBuildSystem) {
    configFile = "pyproject.toml";
  } else if (ctx.hasSetupPy) {
    configFile = "setup.py";
  } else if (ctx.hasSetupCfg) {
    configFile = "setup.cfg";
  }

  let installCommands: PythonInstallCommand[] = [];
  let lockfile: string | undefined;

  const isPackage = ctx.hasSetupPy || ctx.hasSetupCfg || hasProjectOrBuildSystem;

  const reqPathRel = ctx.requirementsDir
    ? getRelativePath(ctx.cwd, path.join(ctx.requirementsDir, "requirements.txt"))
    : "requirements.txt";

  const projectDirRel = getRelativePath(ctx.cwd, ctx.projectDir);

  if (ctx.hasRequirementsTxt && isPackage) {
    installCommands = [
      { executable: "pip", args: ["install", "-r", reqPathRel] },
      { executable: "pip", args: ["install", "-e", projectDirRel] },
    ];
    lockfile = "requirements.txt";
  } else if (ctx.hasRequirementsTxt) {
    installCommands = [{ executable: "pip", args: ["install", "-r", reqPathRel] }];
    lockfile = "requirements.txt";
  } else if (isPackage) {
    installCommands = [{ executable: "pip", args: ["install", "-e", projectDirRel] }];
  }

  return {
    name: "pip",
    lockfile,
    configFile,
    installCommands,
    execPrefix: "",
  };
}

const RUFF_SPECIFIER_REGEX = /^ruff\s*(?:\[[^\]]*\])?\s*(?:[=<>!~@;]|\s|$)/i;

function inspectRuffInSpecifierArray(
  arr: unknown[],
): { declared: boolean; version?: string } | undefined {
  for (const item of arr) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (RUFF_SPECIFIER_REGEX.test(trimmed)) {
        return { declared: true, version: extractRuffVersionSpecifier(trimmed) };
      }
    } else if (isObject(item)) {
      const pkgName =
        typeof item.package === "string"
          ? item.package
          : typeof item.name === "string"
            ? item.name
            : undefined;
      if (pkgName && pkgName.toLowerCase() === "ruff") {
        const verStr = typeof item.version === "string" ? item.version : undefined;
        return {
          declared: true,
          version: verStr ? extractRuffVersionSpecifier(verStr) : undefined,
        };
      }
    }
  }
  return undefined;
}

function inspectRuffInDependencyMap(
  map: Record<string, unknown>,
): { declared: boolean; version?: string } | undefined {
  for (const [key, val] of Object.entries(map)) {
    if (key.toLowerCase() === "ruff") {
      if (typeof val === "string") {
        return { declared: true, version: extractRuffVersionSpecifier(val) };
      }
      if (isObject(val)) {
        const verStr = typeof val.version === "string" ? val.version : undefined;
        return {
          declared: true,
          version: verStr ? extractRuffVersionSpecifier(verStr) : undefined,
        };
      }
      return { declared: true };
    }
  }
  return undefined;
}

function inspectPep621Ruff(project: Record<string, unknown>) {
  if (Array.isArray(project.dependencies)) {
    const res = inspectRuffInSpecifierArray(project.dependencies);
    if (res) return res;
  }
  if (isObject(project["optional-dependencies"])) {
    for (const group of Object.values(project["optional-dependencies"])) {
      if (Array.isArray(group)) {
        const res = inspectRuffInSpecifierArray(group);
        if (res) return res;
      }
    }
  }
  return undefined;
}

function inspectPep735Ruff(depGroups: Record<string, unknown>) {
  for (const group of Object.values(depGroups)) {
    if (Array.isArray(group)) {
      const res = inspectRuffInSpecifierArray(group);
      if (res) return res;
    }
  }
  return undefined;
}

function inspectToolUvRuff(uv: Record<string, unknown>) {
  for (const key of ["dev-dependencies", "override-dependencies", "constraint-dependencies"]) {
    if (Array.isArray(uv[key])) {
      const res = inspectRuffInSpecifierArray(uv[key] as unknown[]);
      if (res) return res;
    }
  }
  return undefined;
}

function inspectPoetryRuff(poetry: Record<string, unknown>) {
  if (isObject(poetry.dependencies)) {
    const res = inspectRuffInDependencyMap(poetry.dependencies);
    if (res) return res;
  }
  if (isObject(poetry["dev-dependencies"])) {
    const res = inspectRuffInDependencyMap(poetry["dev-dependencies"]);
    if (res) return res;
  }
  if (isObject(poetry.group)) {
    for (const grpObj of Object.values(poetry.group)) {
      if (isObject(grpObj) && isObject(grpObj.dependencies)) {
        const res = inspectRuffInDependencyMap(grpObj.dependencies);
        if (res) return res;
      }
    }
  }
  return undefined;
}

function inspectPdmRuff(pdm: Record<string, unknown>) {
  if (isObject(pdm["dev-dependencies"])) {
    for (const grp of Object.values(pdm["dev-dependencies"])) {
      if (Array.isArray(grp)) {
        const res = inspectRuffInSpecifierArray(grp);
        if (res) return res;
      }
    }
  }
  return undefined;
}

function inspectHatchRuff(hatch: Record<string, unknown>) {
  if (isObject(hatch.envs)) {
    for (const envObj of Object.values(hatch.envs)) {
      if (isObject(envObj)) {
        if (Array.isArray(envObj.dependencies)) {
          const res = inspectRuffInSpecifierArray(envObj.dependencies);
          if (res) return res;
        }
        if (Array.isArray(envObj["extra-dependencies"])) {
          const res = inspectRuffInSpecifierArray(envObj["extra-dependencies"]);
          if (res) return res;
        }
      }
    }
  }
  return undefined;
}

function inspectPixiRuff(pixi: Record<string, unknown>) {
  if (isObject(pixi.dependencies)) {
    const res = inspectRuffInDependencyMap(pixi.dependencies);
    if (res) return res;
  }
  if (isObject(pixi["dev-dependencies"])) {
    const res = inspectRuffInDependencyMap(pixi["dev-dependencies"]);
    if (res) return res;
  }
  if (isObject(pixi.feature)) {
    for (const featObj of Object.values(pixi.feature)) {
      if (isObject(featObj)) {
        if (isObject(featObj.dependencies)) {
          const res = inspectRuffInDependencyMap(featObj.dependencies);
          if (res) return res;
        }
        if (isObject(featObj["dev-dependencies"])) {
          const res = inspectRuffInDependencyMap(featObj["dev-dependencies"]);
          if (res) return res;
        }
      }
    }
  }
  return undefined;
}

function inspectToolRuff(tool: Record<string, unknown>) {
  if (isObject(tool.uv)) {
    const res = inspectToolUvRuff(tool.uv);
    if (res) return res;
  }
  if (isObject(tool.poetry)) {
    const res = inspectPoetryRuff(tool.poetry);
    if (res) return res;
  }
  if (isObject(tool.pdm)) {
    const res = inspectPdmRuff(tool.pdm);
    if (res) return res;
  }
  if (isObject(tool.hatch)) {
    const res = inspectHatchRuff(tool.hatch);
    if (res) return res;
  }
  if (isObject(tool.pixi)) {
    const res = inspectPixiRuff(tool.pixi);
    if (res) return res;
  }
  return undefined;
}

/**
 * Inspects pyproject.toml data strictly in supported runtime/dev dependency declarations
 * (PEP 621, PEP 735, tool.uv, Poetry, PDM, Hatch, Pixi). Note: build-system.requires is excluded
 * because build backend requirements are build-time tools, not project linting workflow dependencies.
 */
export function findRuffDependencyInToml(parsed: Record<string, unknown>): {
  declared: boolean;
  version?: string;
} {
  // 1. PEP 621 project.dependencies & project.optional-dependencies
  if (isObject(parsed.project)) {
    const res = inspectPep621Ruff(parsed.project);
    if (res) return res;
  }

  // 2. PEP 735 dependency-groups
  if (isObject(parsed["dependency-groups"])) {
    const res = inspectPep735Ruff(parsed["dependency-groups"]);
    if (res) return res;
  }

  // 3. tool table
  if (isObject(parsed.tool)) {
    const res = inspectToolRuff(parsed.tool);
    if (res) return res;
  }

  return { declared: false };
}

export function hasPythonProject(cwd: string = process.cwd()): boolean {
  if (hasPythonSource(cwd)) {
    return true;
  }

  const resolvedCwd = path.resolve(cwd);
  const dirs = collectParentDirs(resolvedCwd);
  const selfCtx = findSelfManifestContext(resolvedCwd, dirs);

  if (selfCtx) {
    if (selfCtx.pyprojectToml?.success === true) {
      if (isUvProjectConfigPresent(selfCtx.pyprojectToml.data, selfCtx.pyprojectToml.rawContent)) {
        return true;
      }
      if (isRuffDeclaredInProject(cwd, undefined, selfCtx.pyprojectToml)) {
        return true;
      }
    }
    if (
      selfCtx.hasUvLock ||
      selfCtx.hasRequirementsTxt ||
      selfCtx.hasSetupPy ||
      selfCtx.hasSetupCfg
    ) {
      return true;
    }
  }

  const ancestorCtx = findAncestorManifestContext(resolvedCwd, dirs);
  if (ancestorCtx.workspaceRootDir && ancestorCtx.workspaceRootToml?.success === true) {
    const wsConfig = getWorkspaceConfigInDir(ancestorCtx.workspaceRootDir);
    if (wsConfig && isWorkspaceMember(ancestorCtx.workspaceRootDir, resolvedCwd, wsConfig.config)) {
      return true;
    }
  }

  return false;
}

export function detectPythonPackageManager(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): PythonPackageManagerInfo | null {
  if (!hasPythonProject(cwd)) {
    return null;
  }

  const ctx = findPythonProjectContext(cwd);
  if (pyprojectToml !== undefined && pyprojectToml !== null) {
    ctx.pyprojectToml = pyprojectToml;
  }

  const detected = detectUvFromContext(ctx) || detectPipFromContext(ctx);

  if (detected) {
    const verifiedVersion =
      detected.name === "uv" ? getVerifiedUvVersion() : getVerifiedPipVersion();
    if (verifiedVersion) {
      detected.version = verifiedVersion;
      detected.versionSource = "detected";
    } else {
      detected.version = detected.name === "uv" ? DEFAULT_UV_VERSION : DEFAULT_PIP_VERSION;
      detected.versionSource = "default";
    }
    return detected;
  }

  // Standalone Python project without manifest or lockfile
  const pipVersion = getVerifiedPipVersion();
  return {
    name: "pip",
    version: pipVersion || DEFAULT_PIP_VERSION,
    versionSource: pipVersion ? "detected" : "default",
    installCommands: [],
    execPrefix: "",
    isStandalone: true,
  };
}

export function extractRuffVersionSpecifier(raw: string): string | undefined {
  if (!raw) return undefined;

  // Remove environment markers after semicolon e.g. "ruff>=0.6; python_version>='3.10'" -> "ruff>=0.6"
  const withoutMarkers = raw.split(";")[0].trim();

  let cleaned = withoutMarkers
    .replace(/^ruff\b/i, "")
    .replace(/\[[^\]]*\]/g, "") // remove extras like [extra]
    .replace(/['"]/g, "")
    .trim();

  if (cleaned.startsWith("=") && !cleaned.startsWith("==")) {
    cleaned = cleaned.slice(1).trim();
  }

  if (!cleaned) return undefined;

  // Exact pin like ==0.4.2 or 0.4.2 or @0.4.2
  const exactMatch = cleaned.match(/^(?:==|@)?\s*(\d+\.\d+\.\d+(?:[a-z0-9_.-]+)?)$/i);
  if (exactMatch) {
    return exactMatch[1];
  }

  // Non-exact constraints or ranges like >=0.3.0,<0.5.0, ^0.4.0 return undefined so ruff-action uses standard version resolution without guessing
  return undefined;
}

function resolveRuffVersionFromUvLock(cwd: string): string | undefined {
  const uvLockPath = path.join(cwd, "uv.lock");
  if (!fs.existsSync(uvLockPath)) return undefined;
  try {
    const content = fs.readFileSync(uvLockPath, "utf8");
    const blocks = content.split(/^\[\[package\]\]/m);
    for (const block of blocks) {
      const nameMatch = block.match(/^\s*name\s*=\s*["']ruff["']/m);
      if (nameMatch) {
        const versionMatch = block.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
        if (versionMatch && versionMatch[1]) {
          return extractRuffVersionSpecifier(versionMatch[1]) || versionMatch[1];
        }
      }
    }
  } catch {
    // Ignore read error
  }
  return undefined;
}

function resolveRuffVersionFromRequirements(cwd: string): string | undefined {
  const reqPath = path.join(cwd, "requirements.txt");
  if (!fs.existsSync(reqPath)) return undefined;
  try {
    const content = fs.readFileSync(reqPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/#.*/, "").trim();
      if (/^ruff\b/i.test(trimmed)) {
        const ver = extractRuffVersionSpecifier(trimmed);
        if (ver) return ver;
      }
    }
  } catch {
    // Ignore read error
  }
  return undefined;
}

export function resolveRuffVersion(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
): string {
  const ctx = findPythonProjectContext(cwd);
  const parsedPyproject =
    pyprojectToml !== undefined && pyprojectToml !== null ? pyprojectToml : ctx.pyprojectToml;

  const lockVer = resolveRuffVersionFromUvLock(ctx.uvLockDir || cwd);
  if (lockVer) return lockVer;

  if (parsedPyproject?.success === true) {
    const dep = findRuffDependencyInToml(parsedPyproject.data);
    if (dep.version) return dep.version;
  }

  if (ctx.workspaceRootToml?.success === true) {
    const dep = findRuffDependencyInToml(ctx.workspaceRootToml.data);
    if (dep.version) return dep.version;
  }

  if (ctx.uvToml?.success === true) {
    const dep = findRuffDependencyInToml(ctx.uvToml.data);
    if (dep.version) return dep.version;
  }

  const reqVer = resolveRuffVersionFromRequirements(ctx.requirementsDir || cwd);
  if (reqVer) return reqVer;

  return "";
}

export function isRuffDeclaredInProject(
  cwd: string = process.cwd(),
  pmInfo?: PythonPackageManagerInfo,
  pyprojectToml?: ParsedToml | null,
): boolean {
  if (pmInfo?.isStandalone) return false;

  const ver = resolveRuffVersion(cwd, pyprojectToml);
  if (ver) return true;

  const ctx = findPythonProjectContext(cwd);
  const parsedPyproject =
    pyprojectToml !== undefined && pyprojectToml !== null ? pyprojectToml : ctx.pyprojectToml;

  if (parsedPyproject?.success === true) {
    const dep = findRuffDependencyInToml(parsedPyproject.data);
    if (dep.declared) {
      return true;
    }
  }

  if (ctx.workspaceRootToml?.success === true) {
    const dep = findRuffDependencyInToml(ctx.workspaceRootToml.data);
    if (dep.declared) {
      return true;
    }
  }

  if (ctx.uvToml?.success === true) {
    const dep = findRuffDependencyInToml(ctx.uvToml.data);
    if (dep.declared) {
      return true;
    }
  }

  const reqDir = ctx.requirementsDir || cwd;
  const reqPath = path.join(reqDir, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, "utf8");
      const stripped = content.replace(/#.*/g, "");
      if (/^\s*ruff\b/im.test(stripped)) {
        return true;
      }
    } catch {
      // Ignore read error
    }
  }

  return false;
}

/**
 * Cohesive Python environment resolution entry point.
 */
export function resolvePythonEnvironment(cwd: string = process.cwd()): ResolvedPythonEnvironment {
  const isPyProject = hasPythonProject(cwd);

  if (!isPyProject) {
    return {
      detected: false,
      version: "",
      packageManager: null,
      ruffVersion: "",
    };
  }

  const ctx = findPythonProjectContext(cwd);
  const pythonVersion = resolvePythonVersion(cwd, ctx.pyprojectToml);
  const ruffVersion = resolveRuffVersion(cwd, ctx.pyprojectToml);
  const pmInfo = detectPythonPackageManager(cwd, ctx.pyprojectToml);

  return {
    detected: true,
    version: pythonVersion,
    packageManager: pmInfo,
    ruffVersion,
  };
}
