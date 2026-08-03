import { proxyConfig } from "../../core/config.js";
import type { EngineCapability, NormalizedResult, RawSearchResult } from "../base.js";
import { asConfidence, asRecord, asString, result, safeUrl } from "../base.js";
import { BaseApiAdapter, type ApiAdapterOptions } from "./baseApiAdapter.js";

interface TinEyeAdapterOptions extends ApiAdapterOptions {
  apiKey?: string;
  apiSecret?: string;
  endpoint?: string;
  resultCount?: number;
}

/**
 * TinEye REST API adapter (official_api).
 *
 * Documented contract: GET {endpoint}search/?url=<imageUrl>&limit=<n> with
 * HTTP Basic auth (username = API key, password = API secret). Response JSON
 * contains a `results` array whose entries expose `image_url`, `width`,
 * `height`, `file_size`, `match_score` (0-100), and `backlinks[]`.
 *
 * Without credentials the adapter stays honest: `healthCheck()` returns false
 * and `execute()` throws "TinEye adapter is not configured".
 */
export class TinEyeApiAdapter extends BaseApiAdapter {
  readonly id = "tineye";
  readonly name = "TinEye";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api",
  };

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly endpoint: string;
  private readonly resultCount: number;

  constructor(options: TinEyeAdapterOptions = {}) {
    super(options);
    this.apiKey = options.apiKey ?? proxyConfig.secrets.tineyeApiKey;
    this.apiSecret = options.apiSecret ?? proxyConfig.secrets.tineyeApiSecret;
    this.endpoint = options.endpoint ?? proxyConfig.tineyeApiUrl;
    this.resultCount = options.resultCount ?? 15;
  }

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    if (!this.apiKey || !this.apiSecret) throw new Error("TinEye adapter is not configured");
    const params = new URLSearchParams({
      url: imageUrl,
      limit: String(this.resultCount),
    });
    const payload = await this.fetchJson(`${this.endpoint}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString("base64")}`,
      },
    });
    const record = asRecord(payload);
    if (!record || !Array.isArray(record.results)) throw new Error("TinEye returned an invalid response");
    return record.results.filter((item): item is RawSearchResult => Boolean(asRecord(item)));
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    return raw.flatMap((item) => {
      const record = asRecord(item);
      if (!record) return [];
      const imageUrl = safeUrl(record.image_url);
      if (!imageUrl) return [];
      const backlinks = Array.isArray(record.backlinks)
        ? record.backlinks.map(asRecord).filter((b): b is Record<string, unknown> => Boolean(b))
        : [];
      const firstBacklink = backlinks[0];
      const title = asString(firstBacklink?.backlink, 240)
        ?? asString(firstBacklink?.url, 240)
        ?? "TinEye match";
      const width = typeof record.width === "number" ? String(record.width) : asString(record.width);
      const height = typeof record.height === "number" ? String(record.height) : asString(record.height);
      const dimensions = [width, height].filter(Boolean).join("x");
      return [result(this.id, imageUrl, {
        thumbnail: imageUrl,
        confidence: asConfidence(record.match_score),
        title,
        dimensions: dimensions || undefined,
      })];
    });
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiSecret);
  }
}
