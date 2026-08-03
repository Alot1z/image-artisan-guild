import { config } from "../config.js";
import { asConfidence, asRecord, asString, fetchJson, result, safeUrl } from "./base.js";
import type { EngineCapability, IImageSearchAdapter, NormalizedResult, RawSearchResult } from "../types.js";

export class SauceNaoAdapter implements IImageSearchAdapter {
  readonly id = "saucenao";
  readonly name = "SauceNAO";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api",
  };

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    if (!config.sauceNaoApiKey) throw new Error("SauceNAO adapter is not configured");
    const params = new URLSearchParams({
      api_key: config.sauceNaoApiKey,
      output_type: "2",
      numres: "30",
      url: imageUrl,
    });
    const payload = await fetchJson(`https://saucenao.com/search.php?${params}`, { method: "GET" }, AbortSignal.timeout(15_000));
    const record = asRecord(payload);
    if (!record || !Array.isArray(record.results)) throw new Error("SauceNAO returned an invalid response");
    return record.results.filter((item): item is RawSearchResult => Boolean(asRecord(item)));
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    return raw.flatMap((item) => {
      const header = asRecord(item.header);
      const data = asRecord(item.data);
      if (!header || !data) return [];
      const urls = Array.isArray(data.ext_urls) ? data.ext_urls : [data.source, data.url];
      const url = urls.map((candidate) => safeUrl(candidate)).find(Boolean);
      if (!url) return [];
      const thumbnail = safeUrl(header.thumbnail);
      const title = asString(data.title) ?? asString(data.creator) ?? "SauceNAO match";
      const confidence = asConfidence(header.similarity);
      const dimensions = [asString(data.width), asString(data.height)].filter(Boolean).join("x");
      return [result(this.id, url, {
        thumbnail,
        confidence,
        title,
        dimensions: dimensions || undefined,
      })];
    });
  }

  async healthCheck(): Promise<boolean> { return Boolean(config.sauceNaoApiKey); }
}
