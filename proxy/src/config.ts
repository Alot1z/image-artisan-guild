import { proxyConfig } from "./core/config.js";

export const config = {
  port: proxyConfig.port,
  maxConcurrency: proxyConfig.policies.maxConcurrency,
  adapterTimeoutMs: proxyConfig.policies.adapterTimeoutMs,
  maxRetries: proxyConfig.policies.maxRetries,
  cacheTtlMs: proxyConfig.policies.cacheTtlMs,
  cacheMaxEntries: proxyConfig.policies.cacheMaxEntries,
  circuitFailureThreshold: proxyConfig.policies.circuitFailureThreshold,
  circuitResetTimeoutMs: proxyConfig.policies.circuitResetTimeoutMs,
  healthProbeTimeoutMs: proxyConfig.policies.healthProbeTimeoutMs,
  maxResults: proxyConfig.policies.maxResults,
  proxyKey: proxyConfig.secrets.proxyKey,
  sauceNaoApiKey: proxyConfig.secrets.sauceNaoApiKey,
  bingApiKey: proxyConfig.secrets.bingApiKey,
  bingEndpoint: proxyConfig.bingEndpoint,
  lensUploadUrl: proxyConfig.lensUploadUrl,
  lensResultsTimeoutMs: proxyConfig.lensResultsTimeoutMs,
  browserHeadless: proxyConfig.browserHeadless,
  browserViewportWidth: proxyConfig.browserViewportWidth,
  browserViewportHeight: proxyConfig.browserViewportHeight,
  browserUserAgent: proxyConfig.browserUserAgent,
  browserLocale: proxyConfig.browserLocale,
  browserTimezone: proxyConfig.browserTimezone,
};

export { DEFAULT_CONFIG, loadConfig } from "./core/config.js";
export type { OperationalPolicies, ProxyConfig, ProxySecrets } from "./core/config.js";
