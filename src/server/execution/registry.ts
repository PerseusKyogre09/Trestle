import { MockExecutionProvider } from "./mockProvider";
import type { ExecutionProvider } from "./types";

class ExecutionProviderRegistry {
  private providers = new Map<string, ExecutionProvider>();
  private defaultProviderName: string;

  constructor() {
    const mock = new MockExecutionProvider();
    this.register(mock);
    this.defaultProviderName = mock.name;
  }

  register(provider: ExecutionProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name?: string): ExecutionProvider {
    const targetName = name || this.defaultProviderName;
    const provider = this.providers.get(targetName);
    if (!provider) {
      throw new Error(`Execution provider "${targetName}" is not registered.`);
    }
    return provider;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const providerRegistry = new ExecutionProviderRegistry();
