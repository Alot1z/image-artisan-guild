import fs from "node:fs";
import path from "node:path";

export interface OperationalPolicies {
  maxConcurrency: number;
  adapterTimeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  circuitFailureThreshold: number;
  circuitResetTimeoutMs: number;
  healthProbeTimeoutMs: number;
  maxResults: number;
}

export interface ProxySecrets {
  proxyKey: string;
  sauceNaoApiKey: string;
  bingApiKey: string;
}

export interface ProxyConfig {
  port: number;
  policies: OperationalPolicies;
  secrets: ProxySecrets;
  bingEndpoint: string;
  lensUploadUrl: string;
  lensResultsTimeoutMs: number;
  browserHeadless: boolean;
  browserViewportWidth: number;
  browserViewportHeight: number;
  browserUserAgent: string;
  browserLocale: string;
  browserTimezone: string;
}

export interface ConfigSource {
  policies?: Partial<OperationalPolicies>;
  port?: number;
  secrets?: Partial<ProxySecrets>;
  bingEndpoint?: string;
  lensUploadUrl?: string;
  lensResultsTimeoutMs?: number;
  browserHeadless?: boolean;
  browserViewportWidth?: number;
  browserViewportHeight?: number;
  browserUserAgent?: string;
  browserLocale?: string;
  browserTimezone?: string;
}

export const DEFAULT_CONFIG: ProxyConfig = {
  port: 3000,
  policies: {
    maxConcurrency: 12,
    adapterTimeoutMs: 15_000,
    maxRetries: 2,
    cacheTtlMs: 300_000,
    cacheMaxEntries: 64,
    circuitFailureThreshold: 3,
    circuitResetTimeoutMs: 30_000,
    healthProbeTimeoutMs: 5_000,
    maxResults: 500,
  },
  secrets: {
    proxyKey: "",
    sauceNaoApiKey: "",
    bingApiKey: "",
  },
  bingEndpoint: "https://api.bing.microsoft.com/v7.0/images/visualsearch",
  lensUploadUrl: "https://lens.google.com/uploadbyurl",
  lensResultsTimeoutMs: 12_000,
  browserHeadless: true,
  browserViewportWidth: 1366,
  browserViewportHeight: 768,
  browserUserAgent: "",
  browserLocale: "en-US",
  browserTimezone: "UTC",
};

function positiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(Math.floor(parsed), max) : Math.floor(parsed);
}

function nonNegativeInt(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return max ? Math.min(Math.floor(parsed), max) : Math.floor(parsed);
}

function optionalPositiveInt(value: string | undefined, max?: number): number | undefined {
  return value === undefined ? undefined : positiveInt(value, 0, max);
}

function optionalNonNegativeInt(value: string | undefined, max?: number): number | undefined {
  return value === undefined ? undefined : nonNegativeInt(value, 0, max);
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === "true" || value === "1";
}

function sourceFromJson(filePath: string | undefined): ConfigSource {
  if (!filePath) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as ConfigSource : {};
  } catch {
    return {};
  }
}

function envSource(env: NodeJS.ProcessEnv): ConfigSource {
  const policies: Partial<OperationalPolicies> = {};
  const maxConcurrency = optionalPositiveInt(env.RIS_MAX_CONCURRENCY, 15);
  const adapterTimeoutMs = optionalPositiveInt(env.RIS_ADAPTER_TIMEOUT_MS, 15_000);
  const maxRetries = optionalNonNegativeInt(env.RIS_MAX_RETRIES, 2);
  const cacheTtlMs = optionalPositiveInt(env.RIS_CACHE_TTL_MS);
  const cacheMaxEntries = optionalPositiveInt(env.RIS_CACHE_MAX_ENTRIES, 512);
  const circuitFailureThreshold = optionalPositiveInt(env.RIS_CIRCUIT_FAILURE_THRESHOLD, 100);
  const circuitResetTimeoutMs = optionalPositiveInt(env.RIS_CIRCUIT_RESET_TIMEOUT_MS);
  const healthProbeTimeoutMs = optionalPositiveInt(env.RIS_HEALTH_PROBE_TIMEOUT_MS);
  const maxResults = optionalPositiveInt(env.RIS_MAX_RESULTS, 2_000);
  const lensUploadUrl = env.GOOGLE_LENS_UPLOAD_URL;
  const lensResultsTimeoutMs = optionalPositiveInt(env.GOOGLE_LENS_RESULTS_TIMEOUT_MS);
  const browserHeadless = optionalBoolean(env.RIS_BROWSER_HEADLESS);
  const browserViewportWidth = optionalPositiveInt(env.RIS_BROWSER_VIEWPORT_WIDTH, 4096);
  const browserViewportHeight = optionalPositiveInt(env.RIS_BROWSER_VIEWPORT_HEIGHT, 4096);
  const browserUserAgent = env.RIS_BROWSER_USER_AGENT;
  const browserLocale = env.RIS_BROWSER_LOCALE;
  const browserTimezone = env.RIS_BROWSER_TIMEZONE;
  if (maxConcurrency !== undefined) policies.maxConcurrency = maxConcurrency;
  if (adapterTimeoutMs !== undefined) policies.adapterTimeoutMs = adapterTimeoutMs;
  if (maxRetries !== undefined) policies.maxRetries = maxRetries;
  if (cacheTtlMs !== undefined) policies.cacheTtlMs = cacheTtlMs;
  if (cacheMaxEntries !== undefined) policies.cacheMaxEntries = cacheMaxEntries;
  if (circuitFailureThreshold !== undefined) policies.circuitFailureThreshold = circuitFailureThreshold;
  if (circuitResetTimeoutMs !== undefined) policies.circuitResetTimeoutMs = circuitResetTimeoutMs;
  if (healthProbeTimeoutMs !== undefined) policies.healthProbeTimeoutMs = healthProbeTimeoutMs;
  if (maxResults !== undefined) policies.maxResults = maxResults;

  const secrets: Partial<ProxySecrets> = {};
  if (env.RIS_PROXY_KEY !== undefined) secrets.proxyKey = env.RIS_PROXY_KEY.trim();
  if (env.SAUCENAO_API_KEY !== undefined) secrets.sauceNaoApiKey = env.SAUCENAO_API_KEY.trim();
  if (env.BING_VISUAL_SEARCH_API_KEY !== undefined) secrets.bingApiKey = env.BING_VISUAL_SEARCH_API_KEY.trim();

  return {
    ...(env.PORT !== undefined ? { port: positiveInt(env.PORT, DEFAULT_CONFIG.port, 65_535) } : {}),
    policies,
    secrets,
    ...(env.BING_VISUAL_SEARCH_ENDPOINT !== undefined
      ? { bingEndpoint: env.BING_VISUAL_SEARCH_ENDPOINT.trim() || DEFAULT_CONFIG.bingEndpoint }
      : {}),
    ...(lensUploadUrl !== undefined ? { lensUploadUrl: lensUploadUrl.trim() || DEFAULT_CONFIG.lensUploadUrl } : {}),
    ...(lensResultsTimeoutMs !== undefined ? { lensResultsTimeoutMs } : {}),
    ...(browserHeadless !== undefined ? { browserHeadless } : {}),
    ...(browserViewportWidth !== undefined ? { browserViewportWidth } : {}),
    ...(browserViewportHeight !== undefined ? { browserViewportHeight } : {}),
    ...(browserUserAgent !== undefined ? { browserUserAgent: browserUserAgent.trim() } : {}),
    ...(browserLocale !== undefined ? { browserLocale: browserLocale.trim() || DEFAULT_CONFIG.browserLocale } : {}),
    ...(browserTimezone !== undefined ? { browserTimezone: browserTimezone.trim() || DEFAULT_CONFIG.browserTimezone } : {}),
  };
}

function mergeSources(...sources: ConfigSource[]): ProxyConfig {
  const result = structuredClone(DEFAULT_CONFIG);
  for (const source of sources) {
    if (source.port !== undefined) result.port = positiveInt(source.port, result.port, 65_535);
    if (source.bingEndpoint) result.bingEndpoint = source.bingEndpoint;
    if (source.lensUploadUrl) result.lensUploadUrl = source.lensUploadUrl.trim();
    if (source.lensResultsTimeoutMs !== undefined) result.lensResultsTimeoutMs = positiveInt(source.lensResultsTimeoutMs, DEFAULT_CONFIG.lensResultsTimeoutMs);
    if (source.browserHeadless !== undefined) result.browserHeadless = source.browserHeadless;
    if (source.browserViewportWidth !== undefined) result.browserViewportWidth = positiveInt(source.browserViewportWidth, DEFAULT_CONFIG.browserViewportWidth, 4096);
    if (source.browserViewportHeight !== undefined) result.browserViewportHeight = positiveInt(source.browserViewportHeight, DEFAULT_CONFIG.browserViewportHeight, 4096);
    if (source.browserUserAgent !== undefined) result.browserUserAgent = source.browserUserAgent;
    if (source.browserLocale !== undefined) result.browserLocale = source.browserLocale;
    if (source.browserTimezone !== undefined) result.browserTimezone = source.browserTimezone;
    result.policies = { ...result.policies, ...(source.policies ?? {}) };
    result.secrets = { ...result.secrets, ...(source.secrets ?? {}) };
  }
  result.policies.maxConcurrency = positiveInt(result.policies.maxConcurrency, DEFAULT_CONFIG.policies.maxConcurrency, 15);
  result.policies.adapterTimeoutMs = positiveInt(result.policies.adapterTimeoutMs, DEFAULT_CONFIG.policies.adapterTimeoutMs, 15_000);
  result.policies.maxRetries = nonNegativeInt(result.policies.maxRetries, DEFAULT_CONFIG.policies.maxRetries, 2);
  result.policies.cacheTtlMs = positiveInt(result.policies.cacheTtlMs, DEFAULT_CONFIG.policies.cacheTtlMs);
  result.policies.cacheMaxEntries = positiveInt(result.policies.cacheMaxEntries, DEFAULT_CONFIG.policies.cacheMaxEntries, 512);
  result.policies.circuitFailureThreshold = positiveInt(result.policies.circuitFailureThreshold, DEFAULT_CONFIG.policies.circuitFailureThreshold, 100);
  result.policies.circuitResetTimeoutMs = positiveInt(result.policies.circuitResetTimeoutMs, DEFAULT_CONFIG.policies.circuitResetTimeoutMs);
  result.policies.healthProbeTimeoutMs = positiveInt(result.policies.healthProbeTimeoutMs, DEFAULT_CONFIG.policies.healthProbeTimeoutMs);
  result.policies.maxResults = positiveInt(result.policies.maxResults, DEFAULT_CONFIG.policies.maxResults, 2_000);
  return result;
}

export function loadConfig(options: { jsonPath?: string; env?: NodeJS.ProcessEnv } = {}): ProxyConfig {
  return mergeSources(
    sourceFromJson(options.jsonPath ?? process.env.RIS_CONFIG_PATH),
    envSource(options.env ?? process.env),
  );
}

export const proxyConfig = loadConfig();
