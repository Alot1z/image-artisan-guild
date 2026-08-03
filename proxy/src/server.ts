import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { SearchCache } from "./core/cache.js";
import { createLogger, newCorrelationId, newTraceId } from "./core/observability.js";
import { cacheKeyFor, executeAdapters, listAdapters } from "./adapters/manager.js";
import { validatePublicImageUrl } from "./security.js";
import type { AggregateResponse } from "./types.js";

const app = express();
const cache = new SearchCache(config.cacheMaxEntries, config.cacheTtlMs);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb", strict: true }));

function requestId(req: Request): string {
  const existing = req.header("x-request-id");
  return existing && /^[a-zA-Z0-9._-]{1,100}$/.test(existing) ? existing : crypto.randomUUID();
}

function authorized(req: Request): boolean {
  if (!config.proxyKey) return false;
  const value = req.header("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${config.proxyKey}`);
  const supplied = Buffer.from(value);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function parseEngineIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 518) return null;
  if (value.some((item) => typeof item !== "string" || item.length < 1 || item.length > 160)) return null;
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ris-external-proxy", cache_entries: cache.size });
});

app.get("/api/adapters", async (_req, res) => {
  const adapters = await Promise.all(listAdapters().map(async (adapter) => ({
    id: adapter.id,
    name: adapter.name,
    capabilities: adapter.capabilities,
    healthy: await adapter.healthCheck(),
  })));
  res.json({ adapters });
});

app.post("/api/aggregate-search", async (req: Request, res: Response) => {
  const id = requestId(req);
  const trace_id = newTraceId();
  const correlation_id = newCorrelationId();
  const logger = createLogger({ trace_id, correlation_id });
  res.setHeader("x-request-id", id);
  res.setHeader("x-trace-id", trace_id);
  res.setHeader("x-correlation-id", correlation_id);

  if (!authorized(req)) {
    logger({ event: "auth_failed", request_id: id });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Record<string, unknown> | null;
  const imageValue = body?.imageUrl ?? body?.image_url;
  const ids = parseEngineIds(body?.engineIds ?? body?.engine_ids);
  if (!ids) {
    res.status(400).json({ error: "engineIds must be a non-empty array of at most 518 strings" });
    return;
  }

  let imageUrl: string;
  try {
    imageUrl = await validatePublicImageUrl(imageValue);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid imageUrl" });
    return;
  }

  const key = cacheKeyFor(imageUrl, ids);
  const cached = cache.get(key);
  if (cached) {
    logger({
      event: "cache_hit",
      request_id: id,
      cache_level: "search",
      requested_count: ids.length,
      result_count: cached.total_results,
    });
    const response: AggregateResponse = { status: "success", request_id: id, ...cached };
    res.json(response);
    return;
  }

  const started = Date.now();
  const aggregate = await executeAdapters(imageUrl, ids, { trace_id, correlation_id });
  cache.set(key, { total_results: aggregate.results.length, results: aggregate.results, errors: aggregate.errors });
  logger({
    event: "request_complete",
    request_id: id,
    duration_ms: Date.now() - started,
    total_results: aggregate.results.length,
    failures: aggregate.errors.length,
  });
  const response: AggregateResponse = {
    status: "success",
    request_id: id,
    total_results: aggregate.results.length,
    results: aggregate.results,
    errors: aggregate.errors,
  };
  res.json(response);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  createLogger()({ event: "request_error", error: "Unhandled request error" });
  res.status(500).json({ error: "Internal server error" });
});

export default app;
