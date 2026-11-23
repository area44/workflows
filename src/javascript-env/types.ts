export type SupportedRuntime = "node" | "bun";
export type SupportedPackageManager = "npm" | "pnpm" | "bun";

export interface PackageManager {
  name: string;
  source?: "packageManager" | "devEngines" | "lockfile" | "default";
}

export interface JsPackageManifest {
  name?: string;
  scripts?: Record<string, string>;
  packageManager?: string;
  devEngines?: any;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export interface JsProjectEnvironment {
  hasPackageJson: boolean;
  packageJson?: JsPackageManifest;
  packageJsonError?: string;
  packageJsonErrorType?: "read" | "parse";
  packageJsonErrorCause?: unknown;
  hasBunVersionFile: boolean;
  hasNodeVersionFile: boolean;
  nodeFileVersionFile?: string;
  hasPnpmLock: boolean;
  hasPackageLock: boolean;
  hasBunLock: boolean;
}

export interface JsPackageManagerInfo {
  name: SupportedPackageManager;
  source?: "packageManager" | "devEngines" | "lockfile" | "default";
}

export type Toolchain = "vite-plus" | undefined;
export type ToolchainInput = "auto" | "vite-plus";

export interface JsInstallationPlan {
  packageManager: SupportedPackageManager;
  command: string;
  args: string[];
}

export interface ResolvedJavaScriptEnvironment {
  detected: boolean;
  runtime: {
    name: "node" | "bun";
  };
  packageManager: {
    name: "npm" | "pnpm" | "bun";
  };
  toolchain?: "vite-plus";
}
