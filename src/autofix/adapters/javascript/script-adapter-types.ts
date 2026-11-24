export interface TokenizerState {
  inSingleQuote: boolean;
  inDoubleQuote: boolean;
  isEscaped: boolean;
}

export interface SplitState extends TokenizerState {
  hasSyntaxError: boolean;
}

export interface CommandInspection {
  tokens: string[];
  hasUnsupportedSyntax: boolean;
  hasRedirection: boolean;
  hasSyntaxError: boolean;
}

export interface TokenizeScanContext {
  inspection: CommandInspection;
  state: TokenizerState;
}

export interface SplitResult {
  commands: string[];
  hasSyntaxError: boolean;
}

export interface ParsedCommandInvocations {
  invocations: string[][];
  hasSyntaxError: boolean;
}
