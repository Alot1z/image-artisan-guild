import { HttpStatusError } from "../types.js";

export type IntegrationType =
  | "official_api"
  | "partner_api"
  | "playwright"
  | "experimental"
  | "unavailable";

export interface EngineCapability {
  supportsImageUpload: boolean;
  supportsUrlInput: boolean;
  requiresAuth: boolean;
  integrationType: IntegrationType;
}

export interface RawSearchResult {
  [key: string]: unknown;
}

export interface NormalizedResult {
  source_engine: string;
  url: string;
  thumbnail?: string;
  confidence: number;
  metadata: Record<string, string>;
}

export interface AdapterHealth {
  healthy: boolean;
  checkedAt: number;
  consecutiveFailures: number;
  latencyMs?: number;
  error?: string;
}

export interface AdapterLifecycle {
  warmup(): Promise<void>;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface IImageSearchAdapter extends AdapterLifecycle {
  readonly id: string;
  readonly name: string;
  readonly capabilities: EngineCapability;
  execute(imageUrl: string): Promise<RawSearchResult[]>;
  normalize(raw: RawSearchResult[]): NormalizedResult[];
  healthCheck(): Promise<boolean>;
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) throw new HttpStatusError(response.status, `upstream returned ${response.status}`);
  return response.json();
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function asString(value: unknown, maxLength = 1000): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

export function asConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

export function safeUrl(value: unknown): string | undefined {
  const text = asString(value, 4096);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function domainOf(value: string): string {
  try { return new URL(value).hostname; } catch { return "unknown"; }
}

export function result(
  sourceEngine: string,
  url: string,
  options: { thumbnail?: string; confidence?: number; title?: string; dimensions?: string } = {},
): NormalizedResult {
  const metadata: Record<string, string> = { domain: domainOf(url) };
  if (options.title) metadata.title = options.title.slice(0, 240);
  if (options.dimensions) metadata.dimensions = options.dimensions.slice(0, 32);
  return {
    source_engine: sourceEngine,
    url,
    ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
    confidence: asConfidence(options.confidence ?? 0.5),
    metadata,
  };
}

export function raw(value: Record<string, unknown>): RawSearchResult { return value; }
