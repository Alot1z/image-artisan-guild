import type { NormalizedResult } from "../adapters/base.js";
import type { AdapterError } from "../types.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Bounded LRU cache with per-entry TTL expiration. */
export class LruTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface SearchCacheValue {
  total_results: number;
  results: NormalizedResult[];
  errors: AdapterError[];
}

/** Level 1: full aggregate responses, keyed by image + sorted engine ids. */
export class SearchCache extends LruTtlCache<SearchCacheValue> {
  constructor(maxEntries: number, ttlMs: number) {
    super(maxEntries, ttlMs);
  }
}

/** Level 2: per-engine normalized results, keyed by engine id + image hash. */
export class NormalizedCache extends LruTtlCache<NormalizedResult[]> {
  constructor(maxEntries: number, ttlMs: number) {
    super(maxEntries, ttlMs);
  }
}

export interface HealthSnapshot {
  healthy: boolean;
  checkedAt: number;
}

/** Level 3: short-TTL adapter health snapshots, keyed by adapter id. */
export class HealthCache extends LruTtlCache<HealthSnapshot> {
  constructor(maxEntries = 64, ttlMs = 30_000) {
    super(maxEntries, ttlMs);
  }
}
