import { describe, expect, test } from "bun:test";
import { canonicalUrl, hashUrl, sanitizeResult } from "../src/core/normalizer.js";
import { normalizeConfidence, rankResults, sourceWeight } from "../src/core/ranker.js";
import { newCorrelationId, newTraceId } from "../src/core/observability.js";
import { HealthCache, LruTtlCache, NormalizedCache, SearchCache } from "../src/core/cache.js";

const result = (source_engine: string, url: string, confidence: number) => ({
  source_engine,
  url,
  confidence,
  metadata: { domain: "example.com" },
});

describe("RankingEngine", () => {
  test("deduplicates identical URLs by canonical hash and boosts frequency", () => {
    const ranked = rankResults([
      result("saucenao", "https://example.com/a?utm_source=newsletter#top", 0.8),
      result("google-lens", "https://example.com/a#other", 0.7),
      result("bing", "https://example.com/b", 0.9),
    ], { frequencyBoost: 0.1 });

    expect(ranked).toHaveLength(2);
    // URL "a" was found twice: 0.8 + 0.1 = 0.9, tying "b"; stable sort keeps "a" first.
    // The ranker preserves the original clickable URL while hashing the canonical form.
    expect(canonicalUrl(ranked[0]?.url)).toBe("https://example.com/a");
    expect(ranked[0]?.confidence).toBe(0.8);
    expect(canonicalUrl(ranked[1]?.url)).toBe("https://example.com/b");
  });

  test("keeps the highest-confidence copy of a duplicated URL", () => {
    const ranked = rankResults([
      result("low", "https://example.com/a", 0.4),
      result("high", "https://example.com/a", 0.95),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.source_engine).toBe("high");
    expect(ranked[0]?.confidence).toBe(0.95);
  });

  test("applies configurable per-engine source weights", () => {
    const ranked = rankResults([
      result("low", "https://example.com/a", 0.9),
      result("high", "https://example.com/b", 0.5),
    ], { weights: { high: 2 } });

    expect(ranked[0]?.url).toBe("https://example.com/b");
    expect(sourceWeight("high", { high: 2 })).toBe(2);
    expect(sourceWeight("unlisted", {})).toBe(1);
    expect(sourceWeight("neg", { neg: -3 })).toBe(0);
  });

  test("normalizes confidence into 0..1 and honors maxResults", () => {
    const ranked = rankResults([
      result("s", "https://example.com/0", 200),
      result("s", "https://example.com/1", 0.4),
      result("s", "https://example.com/2", 0.3),
      result("s", "https://example.com/3", 0.2),
    ], { maxResults: 2 });

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.confidence).toBe(1); // 200 → clamped to 1
    expect(normalizeConfidence(-5)).toBe(0);
    expect(normalizeConfidence(1.5)).toBe(0.015); // >1 treated as percentage
  });
});

describe("Normalizer", () => {
  test("canonicalizes URLs for stable dedup hashing", () => {
    expect(canonicalUrl("https://EXAMPLE.com/a?utm_source=x#top")).toBe("https://example.com/a");
    expect(canonicalUrl("javascript:alert(1)")).toBeUndefined();
    expect(hashUrl("https://example.com/a#frag")).toBe(hashUrl("https://example.com/a"));
    expect(hashUrl("https://example.com/a")).not.toBe(hashUrl("https://example.com/b"));
  });

  test("sanitizeResult rejects unsafe payloads and clamps fields", () => {
    expect(sanitizeResult(null, "fallback")).toBeUndefined();
    expect(sanitizeResult({ url: "javascript:alert(1)", source_engine: "x", confidence: 1, metadata: {} }, "fallback")).toBeUndefined();

    const clean = sanitizeResult({
      url: "https://example.com/x",
      source_engine: "bad\nname",
      confidence: 500,
      thumbnail: "ftp://nope",
      metadata: { title: "a\u0000b", domain: "evil.com" },
    }, "fallback");

    expect(clean).toBeDefined();
    expect(clean?.source_engine).toBe("bad name");
    expect(clean?.confidence).toBe(1);
    expect(clean?.thumbnail).toBeUndefined();
    expect(clean?.metadata.title).toBe("a b"); // control chars become spaces
    expect(clean?.metadata.domain).toBe("evil.com");
  });
});

describe("Observability", () => {
  test("trace and correlation ids are unique and uuid-shaped", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(newCorrelationId()).toMatch(/^[0-9a-f-]{36}$/i);
    expect(newTraceId()).not.toBe(newTraceId());
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });
});

describe("Multi-level cache", () => {
  test("LruTtlCache evicts the least recently used entry beyond capacity", () => {
    const cache = new LruTtlCache<number>(2, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(2);
  });

  test("LruTtlCache expires entries after their TTL", async () => {
    const cache = new LruTtlCache<string>(10, 15);
    cache.set("k", "v");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cache.get("k")).toBeUndefined();
  });

  test("SearchCache, NormalizedCache, and HealthCache are distinct cache levels", () => {
    const search = new SearchCache(4, 60_000);
    const normalized = new NormalizedCache(4, 60_000);
    const health = new HealthCache();

    search.set("s", { total_results: 1, results: [], errors: [] });
    normalized.set("n", []);
    health.set("google-lens", { healthy: true, checkedAt: Date.now() });

    expect(search.get("s")?.total_results).toBe(1);
    expect(normalized.get("n")).toEqual([]);
    expect(health.get("google-lens")?.healthy).toBe(true);
  });
});
