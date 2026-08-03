import crypto from "node:crypto";
import {
  asConfidence,
  asString,
  domainOf,
  safeUrl,
  type NormalizedResult,
} from "../adapters/base.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "ref_src",
  "spm",
]);

/**
 * Canonical form of a URL used for deduplication: http(s) only, fragment
 * stripped, tracking parameters removed, hostname lowercased.
 */
export function canonicalUrl(value: string): string | undefined {
  const url = safeUrl(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of TRACKING_PARAMS) parsed.searchParams.delete(key);
    if (parsed.search === "?") parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Stable sha-256 fingerprint of the canonical URL form. */
export function hashUrl(value: string): string {
  const canonical = canonicalUrl(value) ?? value.trim().toLowerCase();
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Sanitizes one external response item into a safe NormalizedResult. Rejects
 * non-http(s) payloads, strips control characters, caps string lengths, and
 * clamps confidence to 0..1. Idempotent — safe to run on already-normalized
 * results as defense in depth.
 */
export function sanitizeResult(
  item: Record<string, unknown> | Partial<NormalizedResult>,
  fallbackEngine: string,
): NormalizedResult | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const url = safeUrl(item.url);
  if (!url) return undefined;
  const sourceEngine = asString(item.source_engine, 64) ?? fallbackEngine;
  const confidence = asConfidence(item.confidence);
  const thumbnail = safeUrl(item.thumbnail) ?? undefined;
  const metadata: Record<string, string> = {};
  const rawMeta = typeof item.metadata === "object" && item.metadata !== null
    ? item.metadata as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(rawMeta)) {
    const text = asString(value, 512);
    if (text !== undefined) metadata[key.slice(0, 64)] = text;
  }
  if (!metadata.domain) metadata.domain = domainOf(url);
  return {
    source_engine: sourceEngine,
    url,
    ...(thumbnail ? { thumbnail } : {}),
    confidence,
    metadata,
  };
}
