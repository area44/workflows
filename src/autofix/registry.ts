import type { LanguageProvider, ToolAdapter } from "./types.js";

import { JavaScriptLanguageProvider } from "./providers/javascript.js";
import { PythonLanguageProvider } from "./providers/python.js";

export class AutofixRegistry {
  private providers: Map<string, LanguageProvider> = new Map();
  private standaloneAdapters: Map<string, ToolAdapter> = new Map();

  public registerProvider(provider: LanguageProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): LanguageProvider | undefined {
    return this.providers.get(id);
  }

  public getProviders(): LanguageProvider[] {
    return Array.from(this.providers.values());
  }

  public registerAdapter(adapter: ToolAdapter): void {
    this.standaloneAdapters.set(adapter.id, adapter);
  }

  public getAdapter(id: string): ToolAdapter | undefined {
    return this.standaloneAdapters.get(id);
  }

  public getStandaloneAdapters(): ToolAdapter[] {
    return Array.from(this.standaloneAdapters.values());
  }

  public clear(): void {
    this.providers.clear();
    this.standaloneAdapters.clear();
  }
}

export function createDefaultRegistry(): AutofixRegistry {
  const registry = new AutofixRegistry();
  // Python provider with Ruff default toolchain
  registry.registerProvider(new PythonLanguageProvider());
  // JavaScript/TypeScript provider with hybrid detection
  registry.registerProvider(new JavaScriptLanguageProvider());
  return registry;
}

export const defaultRegistry = createDefaultRegistry();
