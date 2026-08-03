// External reverse-image proxy contract.
//
// The browser never calls provider APIs directly. The proxy owns the adapters
// for the 518 catalog ids and returns one ranked result list. No response is
// persisted in Convex.

"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const resultValidator = v.object({
  id: v.string(),
  title: v.string(),
  sourceUrl: v.string(),
  imageUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  score: v.optional(v.number()),
  matchType: v.optional(v.string()),
  services: v.optional(v.array(v.string())),
});

export type AggregateResult = {
  id: string;
  title: string;
  sourceUrl: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  score?: number;
  matchType?: string;
  services?: string[];
};

type AggregateSuccess = {
  ok: true;
  searchedAt: number;
  serviceCount: number;
  results: AggregateResult[];
};

type AggregateFailure = {
  ok: false;
  error: "missing-config" | "invalid-response" | "proxy-error" | "rate-limited";
  status?: number;
  serviceCount: number;
  results: [];
};

export type AggregateSearchResponse = AggregateSuccess | AggregateFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
    const sourceUrl = asString(item.sourceUrl) ?? asString(item.url);
    if (!sourceUrl) return [];
    const services = Array.isArray(item.services)
      ? item.services.filter((service): service is string => typeof service === "string")
      : undefined;
    return [{
      id: asString(item.id) ?? `proxy-result-${index + 1}`,
      title: asString(item.title) ?? "Untitled match",
      sourceUrl,
      imageUrl: asString(item.imageUrl) ?? asString(item.image),
      thumbnailUrl: asString(item.thumbnailUrl) ?? asString(item.thumbnail),
      width: asNumber(item.width),
      height: asNumber(item.height),
      score: asNumber(item.score),
      matchType: asString(item.matchType),
      services,
    } satisfies AggregateResult];
  });
}

/**
 * Internal implementation. The proxy contract is intentionally small:
 * POST { imageUrl, engineIds } with a bearer key, and return
 * { results: [...] } (or { matches: [...] }).
 */
export const dispatchAggregateSearch = internalAction({
  args: {
    imageUrl: v.string(),
    engineIds: v.array(v.string()),
  },
  handler: async (_ctx, { imageUrl, engineIds }): Promise<AggregateSearchResponse> => {
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
    };
  },
});

/** Public client entry point. The adapter implementation remains internal. */
export const aggregateSearch = action({
  args: {
    imageUrl: v.string(),
    engineIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<AggregateSearchResponse> => {
    return ctx.runAction(internal.aggregate.dispatchAggregateSearch, args);
  },
});

void resultValidator;
