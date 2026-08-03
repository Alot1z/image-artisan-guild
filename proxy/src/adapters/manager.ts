import crypto from "node:crypto";
import { config } from "../config.js";
import { log } from "../logging.js";
import type { AdapterError, IImageSearchAdapter, NormalizedResult } from "../types.js";
import { BingVisualAdapter } from "./bing.js";
import { SauceNaoAdapter } from "./saucenao.js";
import { googleLensStub, tinEyeStub, unavailableAdapter } from "./stubs.js";
import { proxyConfig } from "../core/config.js";
import { AdapterRegistry } from "../core/registry.js";
import { RoutingEngine } from "../core/router.js";
import { ExecutionScheduler } from "../core/scheduler.js";

const registry = new AdapterRegistry();
registry
  .register(new BingVisualAdapter())
  .register(new SauceNaoAdapter())
  .register(tinEyeStub)
  .register(googleLensStub);

const scheduler = new ExecutionScheduler(proxyConfig.policies);
const router = new RoutingEngine(registry, scheduler);

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

export async function executeAdapters(imageUrl: string, engineIds: string[], requestId: string): Promise<ManagerResult> {
  const uniqueIds = [...new Set(engineIds)];
  const routed = await router.route({ imageUrl, engineIds: uniqueIds, priority: "user_requested" });
  const errors = [...routed.errors, ...routed.skipped];
  const deduped = new Map<string, NormalizedResult>();
  for (const found of routed.results) {
    const key = found.url.toLowerCase().replace(/[?#].*$/, "");
    const previous = deduped.get(key);
    if (!previous || found.confidence > previous.confidence) deduped.set(key, found);
  }
  const results = [...deduped.values()].sort((a, b) => b.confidence - a.confidence).slice(0, config.maxResults);
  log({
    event: "aggregate_complete",
    request_id: requestId,
    requested_count: uniqueIds.length,
    success_count: uniqueIds.length - errors.length,
    failure_count: errors.length,
    result_count: results.length,
    circuit_trips: scheduler.circuitSnapshot().filter((item) => item.state === "open").length,
  });
  return { results, errors };
}

export function cacheKeyFor(imageUrl: string, engineIds: string[]): string {
  return cacheKey(imageUrl, engineIds);
}

export function providerRegistry(): AdapterRegistry {
  return registry;
}
