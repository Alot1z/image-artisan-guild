import { HttpStatusError } from "../../types.js";
import type {
  EngineCapability,
  IImageSearchAdapter,
  NormalizedResult,
  RawSearchResult,
} from "../base.js";

export interface ApiAdapterOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export abstract class BaseApiAdapter implements IImageSearchAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: EngineCapability;

  private readonly fetchOverride: typeof fetch | undefined;
  protected readonly requestTimeoutMs: number;
  protected readonly maxRetries: number;
  protected readonly retryDelayMs: number;

  constructor(options: ApiAdapterOptions = {}) {
    this.fetchOverride = options.fetchImpl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 100;
  }

  /**
   * Resolved at call time (not captured at construction) so that
   * late-installed fetch mocks or runtime fetch patching are honored
   * regardless of adapter construction order.
   */
  protected get fetchImpl(): typeof fetch {
    return this.fetchOverride ?? globalThis.fetch;
  }

  async warmup(): Promise<void> {}
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  abstract execute(imageUrl: string): Promise<RawSearchResult[]>;
  abstract normalize(raw: RawSearchResult[]): NormalizedResult[];

  async healthCheck(): Promise<boolean> {
    return true;
  }

  protected async fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    let lastError: unknown = new Error("API request failed");
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const error = new HttpStatusError(response.status, `upstream returned ${response.status}`);
          if (!this.isRetryableStatus(response.status) || attempt >= this.maxRetries) throw error;
          lastError = error;
        } else {
          return response.json();
        }
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt >= this.maxRetries) throw error;
      } finally {
        clearTimeout(timer);
      }
      await this.delay(this.retryDelayMs * 2 ** attempt);
    }
    throw lastError;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof HttpStatusError) return this.isRetryableStatus(error.status);
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError");
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
