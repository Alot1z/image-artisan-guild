import { proxyConfig } from "../../core/config.js";
import type { EngineCapability, NormalizedResult, RawSearchResult } from "../base.js";
import { asConfidence, asRecord, asString, result, safeUrl } from "../base.js";
import { BaseApiAdapter, type ApiAdapterOptions } from "./baseApiAdapter.js";

interface SauceNaoAdapterOptions extends ApiAdapterOptions {
  apiKey?: string;
  endpoint?: string;
  resultCount?: number;
}

export class SauceNaoApiAdapter extends BaseApiAdapter {
  readonly id = "saucenao";
  readonly name = "SauceNAO";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api",
  };

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly resultCount: number;

  constructor(options: SauceNaoAdapterOptions = {}) {
    super(options);
    this.apiKey = options.apiKey ?? proxyConfig.secrets.sauceNaoApiKey;
    this.endpoint = options.endpoint ?? "https://saucenao.com/search.php";
    this.resultCount = options.resultCount ?? 30;
  }

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    if (!this.apiKey) throw new Error("SauceNAO adapter is not configured");
    const params = new URLSearchParams({
      api_key: this.apiKey,
      output_type: "2",
      numres: String(this.resultCount),
      url: imageUrl,
    });
    const payload = await this.fetchJson(`${this.endpoint}?${params.toString()}`, { method: "GET" });
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
      const title = asString(data.title) ?? asString(data.creator) ?? asString(data.author) ?? "SauceNAO match";
      const confidence = asConfidence(header.similarity);
      const width = typeof data.width === "number" ? String(data.width) : asString(data.width);
      const height = typeof data.height === "number" ? String(data.height) : asString(data.height);
      const dimensions = [width, height].filter(Boolean).join("x");
      return [result(this.id, url, {
        thumbnail,
        confidence,
        title,
        dimensions: dimensions || undefined,
      })];
    });
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
