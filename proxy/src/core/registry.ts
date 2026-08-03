import type { IImageSearchAdapter } from "../adapters/base.js";

export class AdapterRegistry {
  private readonly adapters = new Map<string, IImageSearchAdapter>();

  register(adapter: IImageSearchAdapter): this {
    if (!adapter.id.trim()) throw new Error("Adapter id is required");
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  registerMany(adapters: Iterable<IImageSearchAdapter>): this {
    for (const adapter of adapters) this.register(adapter);
    return this;
  }

  getAdapter(id: string): IImageSearchAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  list(): IImageSearchAdapter[] {
    return [...this.adapters.values()];
  }

  get size(): number {
    return this.adapters.size;
  }
}
