import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

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
  };
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
  return parseTomlFile(path.join(cwd, "pyproject.toml"));
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

/**
 * Determines whether a directory contains a Python project, optionally reusing precomputed context and source check.
 */
export function hasPythonProject(
  cwd: string = process.cwd(),
  precomputed?: { ctx?: PythonProjectContext; hasSource?: boolean },
): boolean {
  const hasSource = precomputed?.hasSource ?? hasPythonSource(cwd);
  if (hasSource) {
    return true;
  }

  const ctx = precomputed?.ctx ?? findPythonProjectContext(cwd);

  const isSelf = ctx.projectDir === ctx.cwd && hasOwnManifestFiles(ctx.cwd);
  if (isSelf) {
    if (ctx.pyprojectToml?.success === true) {
      if (isUvProjectConfigPresent(ctx.pyprojectToml.data, ctx.pyprojectToml.rawContent)) {
        return true;
      }
    }
    if (ctx.hasUvLock || ctx.hasRequirementsTxt || ctx.hasSetupPy || ctx.hasSetupCfg) {
      return true;
    }
  }

  if (ctx.workspaceRootDir && ctx.workspaceRootToml?.success === true) {
    const wsConfig = getWorkspaceConfigInDir(ctx.workspaceRootDir);
    if (wsConfig && isWorkspaceMember(ctx.workspaceRootDir, path.resolve(cwd), wsConfig.config)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects Python package manager info from precomputed context without repeating filesystem scans.
 */
function detectPythonPackageManagerFromContext(
  ctx: PythonProjectContext,
  pyprojectToml?: ParsedToml | null,
): PythonPackageManagerInfo {
  if (pyprojectToml !== undefined && pyprojectToml !== null) {
    ctx.pyprojectToml = pyprojectToml;
  }

  for (const pm of PYTHON_PACKAGE_MANAGER_PRIORITY) {
    if (pm === "uv") {
      const uvInfo = detectUvFromContext(ctx);
      if (uvInfo) return uvInfo;
    } else if (pm === "pip") {
      const pipInfo = detectPipFromContext(ctx);
      if (pipInfo) return pipInfo;
    }
  }

  // Standalone Python project without manifest or lockfile
  return {
    name: "pip",
    installCommands: [],
    execPrefix: "",
    isStandalone: true,
  };
}

export function detectPythonPackageManager(
  cwd: string = process.cwd(),
  pyprojectToml?: ParsedToml | null,
  precomputed?: { ctx?: PythonProjectContext; hasSource?: boolean; isProject?: boolean },
): PythonPackageManagerInfo | null {
  const ctx = precomputed?.ctx ?? findPythonProjectContext(cwd);
  const isProject =
    precomputed?.isProject ?? hasPythonProject(cwd, { ctx, hasSource: precomputed?.hasSource });

  if (!isProject) {
    return null;
  }

  return detectPythonPackageManagerFromContext(ctx, pyprojectToml);
}

/**
 * Cohesive Python environment resolution entry point.
 */
export function validateInstallCommands(commands: unknown): void {
  if (!Array.isArray(commands)) {
    throw new Error('Invalid Python environment: "pmInfo.installCommands" must be an array');
  }
  for (const cmd of commands) {
    if (!cmd || typeof cmd !== "object") {
      throw new Error('Invalid Python environment: malformed "installCommands" item');
    }
    const item = cmd as Record<string, unknown>;
    if (
      typeof item.executable !== "string" ||
      !item.executable.trim() ||
      !Array.isArray(item.args) ||
      !item.args.every((a: unknown) => typeof a === "string")
    ) {
      throw new Error('Invalid Python environment: malformed "installCommands" item');
    }
  }
}

export function validatePythonPmInfoStructure(
  pmInfo: unknown,
  errorMessageWhenNonObject: string = 'Invalid Python environment: "pmInfo" must be an object',
): Record<string, unknown> {
  if (!pmInfo || typeof pmInfo !== "object" || Array.isArray(pmInfo)) {
    throw new Error(errorMessageWhenNonObject);
  }
  const obj = pmInfo as Record<string, unknown>;
  if (obj.name !== "uv" && obj.name !== "pip") {
    throw new Error(`Invalid Python environment: pmInfo name must be "uv" or "pip"`);
  }
  validateInstallCommands(obj.installCommands);
  return obj;
}

/**
 * Cohesive Python environment resolution entry point.
 */
export function resolvePythonEnvironment(cwd: string = process.cwd()): ResolvedPythonEnvironment {
  const hasSource = hasPythonSource(cwd);
  const ctx = findPythonProjectContext(cwd);
  const isPyProject = hasPythonProject(cwd, { ctx, hasSource });

  if (!isPyProject) {
    return {
      detected: false,
      packageManager: null,
    };
  }

  const pmInfo = detectPythonPackageManager(cwd, ctx.pyprojectToml, {
    ctx,
    hasSource,
    isProject: true,
  });

  return {
    detected: true,
    packageManager: pmInfo,
  };
}
