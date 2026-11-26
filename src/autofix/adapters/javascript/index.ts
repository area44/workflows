export {
  splitChainedCommands,
  splitChainedCommandsDetailed,
  tokenizeCommandLine,
  inspectAndTokenizeCommandLine,
  unwrapEnvironmentWrapper,
  normalizeCommandTokens,
  getCommandInvocationTokens,
  parseCommandInvocations,
  parseCommandInvocationsDetailed,
  isEnvAssignment,
  extractShellWrapperScript,
} from "./shell-parser";

export {
  delegatesToScript,
  doesFixScriptDelegateTo,
  extractDelegatedTarget,
} from "./delegation-analyzer";

export { hasVitePlusCommand, hasVitePlusScript } from "./vite-plus-detector";

export {
  classifyScript,
  resolveFormatScript,
  resolveLintScript,
  resolveFormatFixCandidate,
  resolveFormatCheckCandidate,
  hasVerifiedFormattingCommand,
  hasVerifiedLintingCommand,
  hasVerifiedFullCheckCommand,
  checkCoverage,
  type ScriptClassification,
} from "./script-classifier";

export {
  resolveScriptTasks,
  resolveFixScriptTasks,
  resolveCheckScriptTasks,
  type ScriptMapping,
} from "./script-task-resolver";

export {
  BaseToolAdapter,
  detectToolAvailability,
  type AdapterConfig,
  type DetectToolOptions,
  type TaskDefinition,
} from "./base-adapter";
