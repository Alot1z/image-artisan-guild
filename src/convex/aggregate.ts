// External reverse-image proxy contract.
//
// The browser never calls provider APIs directly. The proxy owns the adapters
// for the 518 catalog ids and returns one ranked result list. No response is
// persisted in Convex.
//
// SECURITY: RIS_PROXY_URL / RIS_PROXY_KEY are read from server-side Convex
// environment variables only — they never reach the browser bundle. The
// frontend calls these actions, which proxy the request securely.

"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type {
  AggregateDispatchResult,
  AggregateResult,
  EngineManifestEntry,
  EngineManifestResult,
  ProxyEngineError,
} from "../lib/proxyTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Sanitize the proxy's `errors` array (engine_id + reason only). */
function sanitizeErrors(payload: unknown): ProxyEngineError[] {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return [];
  const out: ProxyEngineError[] = [];
  for (const raw of payload.errors) {
    if (!isRecord(raw)) continue;
    const engineId = asString(raw.engine_id) ?? asString(raw.engineId);
    const message = asString(raw.error);
    if (!engineId || !message) continue;
    out.push({ engine_id: engineId, error: message.slice(0, 200) });
  }
  return out;
}

function normalizeResults(payload: unknown): AggregateResult[] | null {
  if (!isRecord(payload)) return null;
  const candidate = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.matches)
      ? payload.matches
      : null;
  if (!candidate) return null;

  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    // Accept both the proxy's public contract (`url`, `thumbnail`,
    // `confidence`, `source_engine`) and the older internal field names so
    // deployments can roll forward without dropping already-returned hits.
    const sourceUrl = asString(item.sourceUrl) ?? asString(item.pageUrl) ?? asString(item.url);
    if (!sourceUrl) return [];
    const services = [
      ...(Array.isArray(item.services)
        ? item.services.filter((service): service is string => typeof service === "string")
        : []),
      ...(asString(item.source_engine) ? [asString(item.source_engine)!] : []),
    ];
    const metadata = isRecord(item.metadata) ? item.metadata : undefined;
    const dimensions = metadata ? asString(metadata.dimensions) : undefined;
    const [widthText, heightText] = dimensions?.split("x") ?? [];
    return [{
      id: asString(item.id) ?? `${asString(item.source_engine) ?? "proxy"}-result-${index + 1}`,
      title: asString(item.title) ?? (asString(item.source_engine) ? `${asString(item.source_engine)} match` : "Untitled match"),
      sourceUrl,
      imageUrl: asString(item.imageUrl) ?? asString(item.image) ?? asString(item.url),
      thumbnailUrl: asString(item.thumbnailUrl) ?? asString(item.thumbnail),
      width: asNumber(item.width) ?? asNumber(widthText),
      height: asNumber(item.height) ?? asNumber(heightText),
      score: asNumber(item.score) ?? asNumber(item.confidence),
      matchType: asString(item.matchType),
      services: services.length > 0 ? [...new Set(services)] : undefined,
    } satisfies AggregateResult];
  });
}

/**
 * Internal implementation. The proxy contract is intentionally small:
 * POST { imageUrl, engineIds } with a bearer key, and return
 * { results: [...] } (or { matches: [...] }) plus an optional
 * `errors` array of per-engine failures.
 */
export const dispatchAggregateSearch = internalAction({
  args: {
    imageUrl: v.string(),
    engineIds: v.array(v.string()),
  },
  handler: async (_ctx, { imageUrl, engineIds }): Promise<AggregateDispatchResult> => {
    const proxyUrl = process.env.RIS_PROXY_URL?.trim();
    const proxyKey = process.env.RIS_PROXY_KEY?.trim();
    const cleanImageUrl = imageUrl.trim();
    const selectedIds = [...new Set(engineIds.map((id) => id.trim()).filter(Boolean))].slice(0, 518);

    if (!proxyUrl || !proxyKey || !cleanImageUrl || selectedIds.length === 0) {
      return { ok: false, error: "missing-config", serviceCount: selectedIds.length, results: [] };
    }

    let response: Response;
    try {
      response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${proxyKey}`,
        },
        body: JSON.stringify({ imageUrl: cleanImageUrl, engineIds: selectedIds }),
      });
    } catch (error) {
      console.error("[aggregate] proxy request failed", error);
      return { ok: false, error: "proxy-error", serviceCount: selectedIds.length, results: [] };
    }

    // Auth rejections are logged server-side (status only) and mapped to a
    // generic client message — never echo the credential or the body.
    if (response.status === 401 || response.status === 403) {
      console.error("[aggregate] proxy rejected credentials", { status: response.status });
      return { ok: false, error: "auth-failed", status: response.status, serviceCount: selectedIds.length, results: [] };
    }
    if (response.status === 429) {
      return { ok: false, error: "rate-limited", status: 429, serviceCount: selectedIds.length, results: [] };
    }
    if (!response.ok) {
      console.error("[aggregate] proxy returned", response.status);
      return { ok: false, error: "proxy-error", status: response.status, serviceCount: selectedIds.length, results: [] };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      console.error("[aggregate] proxy returned invalid JSON", error);
      return { ok: false, error: "invalid-response", status: response.status, serviceCount: selectedIds.length, results: [] };
    }

    const results = normalizeResults(payload);
    if (!results) {
      return { ok: false, error: "invalid-response", status: response.status, serviceCount: selectedIds.length, results: [] };
    }

    return {
      ok: true,
      searchedAt: Date.now(),
      serviceCount: selectedIds.length,
      results: results.slice(0, 200),
      errors: sanitizeErrors(payload),
    };
  },
});

/** Public client entry point. The adapter implementation remains internal. */
export const aggregateSearch = action({
  args: {
    imageUrl: v.string(),
    engineIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<AggregateDispatchResult> => {
    return ctx.runAction(internal.aggregate.dispatchAggregateSearch, args);
  },
});

/** Derive the adapter-manifest endpoint from the configured proxy URL. */
function manifestEndpointFor(proxyUrl: string): string {
  const trimmed = proxyUrl.replace(/\/+$/, "");
  const aggregatePath = /\/api\/aggregate-search$/i;
  const base = aggregatePath.test(trimmed) ? trimmed.replace(aggregatePath, "") : trimmed;
  return `${base}/api/adapters`;
}

/**
 * Live adapter manifest from the external proxy (GET /api/adapters).
 * Lets the workbench distinguish "active" adapters from "planned" ones
 * without ever shipping the proxy key to the browser.
 */
export const enginesManifest = action({
  args: {},
  handler: async (): Promise<EngineManifestResult> => {
    const proxyUrl = process.env.RIS_PROXY_URL?.trim();
    const proxyKey = process.env.RIS_PROXY_KEY?.trim();
    if (!proxyUrl || !proxyKey) return { ok: false, error: "missing-config" };

    let response: Response;
    try {
      response = await fetch(manifestEndpointFor(proxyUrl), {
        headers: { Authorization: `Bearer ${proxyKey}` },
      });
    } catch (error) {
      console.error("[aggregate] adapter manifest request failed", error);
      return { ok: false, error: "proxy-error" };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "auth-failed" };
    }
    if (!response.ok) {
      return { ok: false, error: "proxy-error" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, error: "invalid-response" };
    }
    if (!isRecord(payload) || !Array.isArray(payload.adapters)) {
      return { ok: false, error: "invalid-response" };
    }

    const entries: EngineManifestEntry[] = [];
    for (const raw of payload.adapters) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      if (!id) continue;
      const capabilities = isRecord(raw.capabilities) ? raw.capabilities : undefined;
      const integrationType = asString(capabilities?.integrationType);
      entries.push({
        id,
        name: asString(raw.name) ?? id,
        status: integrationType === "unavailable" ? "planned" : "active",
        healthy: typeof raw.healthy === "boolean" ? raw.healthy : undefined,
        integrationType,
      });
    }
    return { ok: true, entries };
  },
});
