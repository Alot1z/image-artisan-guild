import crypto from "node:crypto";
import { config } from "../config.js";
import type { AdapterError, IImageSearchAdapter, NormalizedResult } from "../types.js";
import { BingVisualAdapter } from "./bing.js";
import { SauceNaoApiAdapter } from "./api/sauceNaoAdapter.js";
import { GoogleLensAdapter } from "./browser/googleLensAdapter.js";
import { tinEyeStub, unavailableAdapter } from "./stubs.js";
import { proxyConfig } from "../core/config.js";
import { AdapterRegistry } from "../core/registry.js";
import { RoutingEngine } from "../core/router.js";
import { ExecutionScheduler } from "../core/scheduler.js";
import { HealthCache, NormalizedCache } from "../core/cache.js";
import { hashUrl, sanitizeResult } from "../core/normalizer.js";
import { rankResults } from "../core/ranker.js";
import { createLogger, type TraceContext } from "../core/observability.js";

const registry = new AdapterRegistry();
registry
  .register(new BingVisualAdapter())
  .register(new SauceNaoApiAdapter())
  .register(tinEyeStub)
  .register(new GoogleLensAdapter());

const scheduler = new ExecutionScheduler(proxyConfig.policies);
const healthCache = new HealthCache();
const normalizedCache = new NormalizedCache(proxyConfig.policies.cacheMaxEntries, proxyConfig.policies.cacheTtlMs);
const router = new RoutingEngine(registry, scheduler, healthCache);

export interface ManagerResult {
  results: NormalizedResult[];
  errors: AdapterError[];
}

export function adapterFor(id: string): IImageSearchAdapter {
  return registry.getAdapter(id) ?? unavailableAdapter(id);
}

export function listAdapters(): IImageSearchAdapter[] {
  return registry.list();
}

function cacheKey(imageUrl: string, engineIds: string[]): string {
  return crypto.createHash("sha256").update(`${imageUrl}\n${[...engineIds].sort().join("\n")}`).digest("hex");
}

function normalizedKey(engineId: string, imageUrl: string): string {
  return `${engineId}|${hashUrl(imageUrl)}`;
}

export async function executeAdapters(
  imageUrl: string,
  engineIds: string[],
  trace: TraceContext = {},
): Promise<ManagerResult> {
  const logger = createLogger(trace);
  const uniqueIds = [...new Set(engineIds)];

  // Level 2: serve per-engine normalized results from the NormalizedCache.
  const served: NormalizedResult[] = [];
  const remaining: string[] = [];
  for (const id of uniqueIds) {
    const cached = normalizedCache.get(normalizedKey(id, imageUrl));
    if (cached) served.push(...cached);
    else remaining.push(id);
  }

  const routed = remaining.length > 0
    ? await router.route({ imageUrl, engineIds: remaining, priority: "user_requested" })
    : {
        results: [] as NormalizedResult[],
        errors: [] as AdapterError[],
        skipped: [] as AdapterError[],
        perEngine: new Map<string, NormalizedResult[]>(),
      };

  for (const [engineId, results] of routed.perEngine) {
    const sanitized = results.flatMap((item) => {
      const clean = sanitizeResult(item, engineId);
      return clean ? [clean] : [];
    });
    if (sanitized.length > 0) normalizedCache.set(normalizedKey(engineId, imageUrl), sanitized);
  }

  const errors = [...routed.errors, ...routed.skipped];
  const all = [...served, ...routed.results].flatMap((item) => {
    const clean = sanitizeResult(item, typeof item?.source_engine === "string" ? item.source_engine : "unknown");
    return clean ? [clean] : [];
  });
  const ranked = rankResults(all, {
    weights: proxyConfig.weights,
    maxResults: config.maxResults,
  });

  logger({
    event: "aggregate_complete",
    requested_count: uniqueIds.length,
    routed_count: remaining.length,
    cached_count: uniqueIds.length - remaining.length,
    success_count: uniqueIds.length - errors.length,
    failure_count: errors.length,
    result_count: ranked.length,
    circuit_trips: scheduler.circuitSnapshot().filter((item) => item.state === "open").length,
  });
  return { results: ranked, errors };
}

export function cacheKeyFor(imageUrl: string, engineIds: string[]): string {
  return cacheKey(imageUrl, engineIds);
}

export function providerRegistry(): AdapterRegistry {
  return registry;
}

/** Run every registered adapter's cleanup hook (e.g. close Playwright browsers). */
export async function shutdownAdapters(): Promise<void> {
  await Promise.allSettled(registry.list().map((adapter) => adapter.cleanup()));
}
