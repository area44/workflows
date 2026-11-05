export interface ConsumerProjectOptions {
  action?: string;
  runtime?: string;
  pm?: string;
  packageManager?: string;
  toolchain?: string;
  type?: string;
  hasPythonSource?: boolean;
  pythonPm?: string;
  ruffVersion?: string;
  markerContent?: string;
  allowNonEmpty?: boolean;
  overwrite?: boolean;
  [key: string]: unknown;
}

export function generateConsumerProjectFiles(
  options?: ConsumerProjectOptions,
): Record<string, string>;

export function createConsumerProject(
  targetDir: string,
  options?: ConsumerProjectOptions,
): Record<string, string>;

export function getLockfileTemplates(customPath?: string): Record<string, string>;

export function normalizePythonProjectName(name: string): string;
