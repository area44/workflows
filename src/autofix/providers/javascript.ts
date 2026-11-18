import type { LanguageProvider, ProjectContext, ToolAdapter } from "../types.js";

import { JavaScriptScriptAdapter } from "../adapters/javascript/script-adapter.js";
import {
  BiomeAdapter,
  EslintAdapter,
  OxfmtAdapter,
  OxlintAdapter,
  PrettierAdapter,
  VitePlusAdapter,
} from "../adapters/javascript/tools.js";

export class JavaScriptLanguageProvider implements LanguageProvider {
  public readonly id = "javascript";
  public readonly name = "JavaScript/TypeScript";

  private scriptAdapter = new JavaScriptScriptAdapter();
  private vitePlusAdapter = new VitePlusAdapter();
  private biomeAdapter = new BiomeAdapter();
  private prettierAdapter = new PrettierAdapter();
  private eslintAdapter = new EslintAdapter();
  private oxlintAdapter = new OxlintAdapter();
  private oxfmtAdapter = new OxfmtAdapter();

  public detect(context: ProjectContext): boolean {
    return Boolean(context.jsEnv?.hasPackageJson);
  }

  public getAdapters(_context: ProjectContext): ToolAdapter[] {
    // Return all candidate adapters in precedence order:
    // 1. Explicit scripts
    // 2. Vite+ (project-native toolchain)
    // 3. Biome (unified tool)
    // 4. Prettier / ESLint / Oxlint / Oxfmt (specialized tools)
    return [
      this.scriptAdapter,
      this.vitePlusAdapter,
      this.biomeAdapter,
      this.oxfmtAdapter,
      this.prettierAdapter,
      this.oxlintAdapter,
      this.eslintAdapter,
    ];
  }
}
