// Shared contract between the FreeBuff frontend and the Convex backend for
// the external RIS proxy (Node.js/Express).
//
// The proxy owns the adapters for the 518 engine catalog ids and returns one
// ranked result set. These types mirror the proxy's HTTP contract so the
// Convex actions and the workbench UI agree on the wire shape without drift.
//
// SECURITY: this module contains only types. It must never import or export
// runtime credentials — the proxy key lives exclusively in server-side
// Convex environment variables (RIS_PROXY_KEY / RIS_PROXY_URL) and is never
// shipped to the browser bundle.

/** A single normalized match from the proxy's ranked result set. */
export interface SearchResult {
  /** Engine id that found this match (e.g. "saucenao"). */
  source_engine: string;
  /** Page URL of the match (safe http(s) only). */
  url: string;
  /** Optional thumbnail image URL. */
  thumbnail?: string;
  /** Match confidence, normalized to 0.0–1.0. */
  confidence?: number;
  metadata?: {
    domain?: string;
    dimensions?: string;
  };
}

/** An engine that failed during a search, surfaced alongside successful results. */
export interface ProxyEngineError {
  engine_id: string;
  error: string;
}

/** Request body for POST /api/aggregate-search. */
export interface AggregateSearchRequest {
  /** Publicly reachable image URL to reverse-search. */
  imageUrl: string;
  /** Engine catalog ids to query (max 518). */
  engineIds: string[];
}

/** Wire response from POST /api/aggregate-search (status: "success"). */
export interface AggregateSearchResponse {
  status: "success";
  request_id: string;
  total_results: number;
  results: SearchResult[];
  /** Partial failures — present even on success when some engines errored. */
  errors: ProxyEngineError[];
}

/** Adapter availability as reported by the proxy manifest. */
export type EngineStatus = "active" | "planned";

/** One row of the proxy adapter manifest (GET /api/adapters). */
export interface EngineManifestEntry {
  id: string;
  name: string;
  status: EngineStatus;
  healthy?: boolean;
  integrationType?: string;
}

/** Normalized result shape rendered by the workbench (Convex-adapted). */
export interface AggregateResult {
  id: string;
  title: string;
  sourceUrl: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  score?: number;
  matchType?: string;
  services?: string[];
}

/** Failure kinds the Convex action can return to the UI. */
export type AggregateFailureKind =
  | "missing-config"
  | "auth-failed"
  | "proxy-error"
  | "rate-limited"
  | "invalid-response";

/** Return value of the public `aggregateSearch` Convex action. */
export type AggregateDispatchResult =
  | {
      ok: true;
      searchedAt: number;
      serviceCount: number;
      results: AggregateResult[];
      errors: ProxyEngineError[];
    }
  | {
      ok: false;
      error: AggregateFailureKind;
      status?: number;
      serviceCount: number;
      results: [];
    };

/** Return value of the public `enginesManifest` Convex action. */
export type EngineManifestResult =
  | { ok: true; entries: EngineManifestEntry[] }
  | {
      ok: false;
      error: "missing-config" | "auth-failed" | "proxy-error" | "invalid-response";
    };

/**
 * Strict search-execution state machine for the workbench:
 * idle → uploading → searching → processing → complete (or → failed).
 */
export type SearchPhase =
  | "idle"
  | "uploading"
  | "searching"
  | "processing"
  | "complete"
  | "failed";
