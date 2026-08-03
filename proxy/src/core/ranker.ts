import type { NormalizedResult } from "../adapters/base.js";
import { asConfidence } from "../adapters/base.js";
import { hashUrl } from "./normalizer.js";

export interface RankOptions {
  /** Per-engine multipliers; engines without an entry use 1.0. */
  weights?: Record<string, number>;
  /** Confidence added per additional engine that found the same URL. */
  frequencyBoost?: number;
  maxResults?: number;
}

const DEFAULT_FREQUENCY_BOOST = 0.1;
const DEFAULT_MAX_RESULTS = 500;

/** Normalize any confidence value into the 0..1 range (percentages handled). */
export function normalizeConfidence(value: unknown): number {
  return asConfidence(value);
}

/** Effective weight for an engine, always non-negative, defaulting to 1.0. */
export function sourceWeight(engineId: string, weights: Record<string, number> = {}): number {
  return Math.max(0, weights[engineId] ?? 1);
}

export interface RankedEntry {
  result: NormalizedResult;
  score: number;
  occurrences: number;
}

/**
 * Deduplicates results by canonical URL hash, keeps the highest-confidence
 * copy of each URL, boosts confidence by how many engines found it, applies
 * per-engine source weights, and returns results ranked by score.
 */
export function rankResults(
  results: NormalizedResult[],
  options: RankOptions = {},
): NormalizedResult[] {
  const weights = options.weights ?? {};
  const frequencyBoost = options.frequencyBoost ?? DEFAULT_FREQUENCY_BOOST;
  const maxResults = Math.max(0, options.maxResults ?? DEFAULT_MAX_RESULTS);

  const buckets = new Map<string, { result: NormalizedResult; occurrences: number }>();
  for (const item of results) {
    if (!item || typeof item.url !== "string") continue;
    const clean: NormalizedResult = {
      ...item,
      confidence: normalizeConfidence(item.confidence),
    };
    const key = hashUrl(clean.url);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { result: clean, occurrences: 1 });
      continue;
    }
    existing.occurrences += 1;
    if (clean.confidence > existing.result.confidence) existing.result = clean;
  }

  const ranked: RankedEntry[] = [...buckets.values()].map(({ result, occurrences }) => {
    const boosted = occurrences > 1
      ? result.confidence + frequencyBoost * (occurrences - 1)
      : result.confidence;
    const score = Math.min(1, boosted) * sourceWeight(result.source_engine, weights);
    return { result, score, occurrences };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, maxResults).map((entry) => entry.result);
}
