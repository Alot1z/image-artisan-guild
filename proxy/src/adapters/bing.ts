import { config } from "../config.js";
import { asConfidence, asRecord, asString, fetchJson, result, safeUrl } from "./base.js";
import type { EngineCapability, IImageSearchAdapter, NormalizedResult, RawSearchResult } from "./base.js";

/**
 * Collect candidate action records from the documented Bing Visual Search
 * response. The API nests results as `tags[] -> actions[]`; each action has an
 * `actionType` (e.g. "PagesIncluding", "VisualSearch") and a `value` array of
 * image objects. We recurse so the adapter is robust to both the full shape
 * and simpler mocked payloads.
 */
function collectActions(value: unknown, output: RawSearchResult[] = []): RawSearchResult[] {
  if (Array.isArray(value)) {
    for (const item of value) collectActions(item, output);
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  if (typeof record.actionType === "string" || typeof record.type === "string") output.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectActions(child, output);
  }
  return output;
}

/** Normalize one image candidate object (may come from `action.value` or `action.image`). */
function normalizeImage(
  engineId: string,
  candidate: Record<string, unknown>,
  fallbackTitle: string,
  fallbackScore: number,
): NormalizedResult[] {
  const url = safeUrl(candidate.contentUrl) ?? safeUrl(candidate.hostPageUrl);
  if (!url) return [];
  const thumbnail = safeUrl(candidate.thumbnailUrl)
    ?? safeUrl(asRecord(candidate.thumbnail)?.url)
    ?? safeUrl(candidate.thumbnail);
  const title = asString(candidate.name) ?? asString(candidate.displayName) ?? fallbackTitle;
  const confidence = asConfidence(candidate.score ?? fallbackScore);
  return [result(engineId, url, { thumbnail, confidence, title })];
}

export class BingVisualAdapter implements IImageSearchAdapter {
  readonly id = "bing";
  readonly name = "Bing Visual Search";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api",
  };

  async warmup(): Promise<void> {}
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    if (!config.bingApiKey) throw new Error("Bing Visual Search adapter is not configured");
    // Documented v7.0 contract: form-urlencoded body whose `imageInfo` field is
    // a JSON string describing the image. Content-Type must NOT be
    // application/json or the API rejects the request.
    const body = new URLSearchParams();
    body.set("imageInfo", JSON.stringify({ imageInfo: { url: imageUrl } }));
    const payload = await fetchJson(config.bingEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": config.bingApiKey,
      },
      body: body.toString(),
    }, AbortSignal.timeout(config.adapterTimeoutMs));
    return collectActions(payload);
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    return raw.flatMap((action) => {
      const record = asRecord(action);
      if (!record) return [];
      const fallbackScore = asConfidence(record.score ?? 0.5);
      const candidates: Array<Record<string, unknown>> = [];
      // Documented shape: `value` is an array of image objects.
      if (Array.isArray(record.value)) {
        for (const item of record.value) {
          const image = asRecord(item);
          if (image) candidates.push(image);
        }
      } else if (asRecord(record.value)) {
        candidates.push(asRecord(record.value)!);
      }
      if (asRecord(record.image)) candidates.push(asRecord(record.image)!);
      if (candidates.length === 0) candidates.push(record);

      const title = asString(record.displayName) ?? "Bing Visual match";
      return candidates.flatMap((candidate) =>
        normalizeImage(this.id, candidate, title, fallbackScore));
    });
  }

  async healthCheck(): Promise<boolean> { return Boolean(config.bingApiKey); }
}
