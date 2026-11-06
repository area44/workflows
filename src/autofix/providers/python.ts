import type { LanguageProvider, ProjectContext, ToolAdapter } from "../types.js";

import { hasPythonSource } from "../../python-env.js";
import { RuffAdapter } from "../adapters/python/ruff.js";

export class PythonLanguageProvider implements LanguageProvider {
  public readonly id = "python";
  public readonly name = "Python";

  private ruffAdapter = new RuffAdapter();

  public detect(context: ProjectContext): boolean {
    return context.hasPythonSource ?? hasPythonSource(context.cwd);
  }

  public getAdapters(_context: ProjectContext): ToolAdapter[] {
    return [this.ruffAdapter];
  }
}
