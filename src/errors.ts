export type WorkflowErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_RUNTIME_OR_PM"
  | "UNSUPPORTED_COMBINATION"
  | "MISSING_CONFIGURATION"
  | "SETUP_FAILURE"
  | "COMMAND_EXECUTION_FAILURE";

export interface WorkflowErrorContext {
  action?: string;
  stage?: string;
  resource?: string;
  path?: string;
  cause?: unknown;
  [key: string]: unknown;
}

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly context?: WorkflowErrorContext;

  constructor(code: WorkflowErrorCode, message: string, context?: WorkflowErrorContext) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.context = context;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isWorkflowError(error: unknown): error is WorkflowError {
  return (
    error instanceof WorkflowError ||
    (typeof error === "object" &&
      error !== null &&
      (error as Record<string, unknown>).name === "WorkflowError" &&
      typeof (error as Record<string, unknown>).code === "string")
  );
}
