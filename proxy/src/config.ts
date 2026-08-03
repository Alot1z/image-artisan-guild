function positiveInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export const config = {
  port: positiveInt(process.env.PORT, 3000, 65535),
  maxConcurrency: positiveInt(process.env.RIS_MAX_CONCURRENCY, 12, 15),
  adapterTimeoutMs: positiveInt(process.env.RIS_ADAPTER_TIMEOUT_MS, 15_000, 15_000),
  maxRetries: positiveInt(process.env.RIS_MAX_RETRIES, 2, 2),
  cacheTtlMs: positiveInt(process.env.RIS_CACHE_TTL_MS, 300_000),
  cacheMaxEntries: positiveInt(process.env.RIS_CACHE_MAX_ENTRIES, 64, 512),
  proxyKey: process.env.RIS_PROXY_KEY?.trim() ?? "",
  sauceNaoApiKey: process.env.SAUCENAO_API_KEY?.trim() ?? "",
  bingApiKey: process.env.BING_VISUAL_SEARCH_API_KEY?.trim() ?? "",
  bingEndpoint:
    process.env.BING_VISUAL_SEARCH_ENDPOINT?.trim() ||
    "https://api.bing.microsoft.com/v7.0/images/visualsearch",
};
