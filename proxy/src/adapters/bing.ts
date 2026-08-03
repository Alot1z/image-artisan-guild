import { config } from "../config.js";
import { asConfidence, asRecord, asString, fetchJson, result, safeUrl } from "./base.js";
import type { EngineCapability, IImageSearchAdapter, NormalizedResult, RawSearchResult } from "../types.js";

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

export class BingVisualAdapter implements IImageSearchAdapter {
  readonly id = "bing";
  readonly name = "Bing Visual Search";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api",
  };

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    if (!config.bingApiKey) throw new Error("Bing Visual Search adapter is not configured");
    const payload = await fetchJson(config.bingEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": config.bingApiKey,
      },
      body: JSON.stringify({ imageInfo: { url: imageUrl } }),
    }, AbortSignal.timeout(15_000));
    return collectActions(payload);
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    return raw.flatMap((action) => {
      const record = asRecord(action);
      if (!record) return [];
      const image = asRecord(record.image) ?? asRecord(record.value) ?? record;
      const url = safeUrl(image?.contentUrl) ?? safeUrl(image?.hostPageUrl);
      if (!url) return [];
      const thumbnail = safeUrl(image?.thumbnailUrl) ?? safeUrl(image?.thumbnail);
      const title = asString(image?.name) ?? asString(image?.displayName) ?? "Bing Visual match";
      const confidence = asConfidence(record.score ?? image?.score ?? 0.5);
      return [result(this.id, url, { thumbnail, confidence, title })];
    });
  }

  async healthCheck(): Promise<boolean> { return Boolean(config.bingApiKey); }
}
