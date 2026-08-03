import crypto from "node:crypto";
import pLimit from "p-limit";
import { config } from "../config.js";
import { log, isRateLimitError, safeAdapterError } from "../logging.js";
import { AdapterNotImplementedError, type AdapterError, type IImageSearchAdapter, type NormalizedResult } from "../types.js";
import { BingVisualAdapter } from "./bing.js";
import { SauceNaoAdapter } from "./saucenao.js";
import { googleLensStub, tinEyeStub, unavailableAdapter } from "./stubs.js";

const adapters = new Map<string, IImageSearchAdapter>([
  ["bing", new BingVisualAdapter()],
  ["saucenao", new SauceNaoAdapter()],
  ["tineye", tinEyeStub],
  ["google-lens", googleLensStub],
]);

export interface ManagerResult {
  results: NormalizedResult[];
  errors: AdapterError[];
}

export function adapterFor(id: string): IImageSearchAdapter {
  return adapters.get(id) ?? unavailableAdapter(id);
}

export function listAdapters(): IImageSearchAdapter[] {
  return [...adapters.values()];
}

function cacheKey(imageUrl: string, engineIds: string[]): string {
  return crypto.createHash("sha256").update(`${imageUrl}\n${[...engineIds].sort().join("\n")}`).digest("hex");
}

async function executeWithRetry(adapter: IImageSearchAdapter, imageUrl: string, requestId: string): Promise<NormalizedResult[]> {
  let lastError: unknown = new Error("Adapter execution failed");
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.adapterTimeoutMs);
      try {
        const raw = await Promise.race([
          adapter.execute(imageUrl),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              const timeout = new Error("Timeout exceeded");
              timeout.name = "AbortError";
              reject(timeout);
            }, { once: true });
          }),
        ]);
        const normalized = adapter.normalize(raw);
        log({ event: "adapter_complete", request_id: requestId, engine_id: adapter.id, duration_ms: Date.now() - started, result_count: normalized.length, attempt: attempt + 1 });
        return normalized;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error)) log({ event: "adapter_rate_limit", request_id: requestId, engine_id: adapter.id, attempt: attempt + 1 });
      if (attempt < config.maxRetries && !(error instanceof AdapterNotImplementedError)) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function executeAdapters(imageUrl: string, engineIds: string[], requestId: string): Promise<ManagerResult> {
  const uniqueIds = [...new Set(engineIds)];
  const limit = pLimit(config.maxConcurrency);
  const settled = await Promise.all(uniqueIds.map((id) => limit(async () => {
    const adapter = adapterFor(id);
    try {
      return { id, results: await executeWithRetry(adapter, imageUrl, requestId) };
    } catch (error) {
      const safeError = safeAdapterError(error);
      log({ event: "adapter_failed", request_id: requestId, engine_id: id, error: safeError });
      return { id, results: [] as NormalizedResult[], error: safeError };
    }
  })));

  const errors = settled.flatMap((item) => item.error ? [{ engine_id: item.id, error: item.error }] : []);
  const deduped = new Map<string, NormalizedResult>();
  for (const item of settled) {
    for (const found of item.results) {
      const key = found.url.toLowerCase().replace(/[?#].*$/, "");
      const previous = deduped.get(key);
      if (!previous || found.confidence > previous.confidence) deduped.set(key, found);
    }
  }
  const results = [...deduped.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 500);
  log({ event: "aggregate_complete", request_id: requestId, requested_count: uniqueIds.length, success_count: uniqueIds.length - errors.length, failure_count: errors.length, result_count: results.length });
  return { results, errors };
}

export function cacheKeyFor(imageUrl: string, engineIds: string[]): string { return cacheKey(imageUrl, engineIds); }
