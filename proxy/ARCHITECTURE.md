# RIS External Proxy — Architecture

> Maintenance documentation. This describes the system as built — read it
> before changing anything. If a behavior here disagrees with the code, the
> code wins and this document should be updated in the same change.
>
> Companion docs: [CONTRIBUTING.md](CONTRIBUTING.md) (how to add adapters) ·
> [CHANGELOG.md](CHANGELOG.md) · [README.md](README.md)

## 1. System pipeline

```mermaid
flowchart LR
    A[HTTP request] --> B[Validation]
    B --> C[Capability Negotiation]
    C --> D[Routing Engine]
    D --> E[Execution Scheduler]
    E --> F[Explicit Provider Registry]
    F --> G[Adapters]
    G --> H[Normalizer]
    H --> I[Ranking Engine]
    I --> J[Response]
```

`Request → Validation → Capability Negotiation → Routing Engine → Execution Scheduler → Explicit Provider Registry → Adapters → Normalizer → Ranking Engine → Response`

Walk-through of one `POST /api/aggregate-search` (`src/server.ts`):

1. **Validation** — bearer auth (timing-safe compare against `RIS_PROXY_KEY`),
   `engineIds` shape check (non-empty array, ≤ 518 strings), `imageUrl`
   SSRF validation (`src/security.ts`, DNS-resolved rejection of private /
   loopback / link-local / metadata / multicast addresses). Body capped at
   32 KB.
2. **Trace setup** — a `trace_id` + `correlation_id` are generated and echoed
   as `x-trace-id` / `x-correlation-id` response headers and threaded into
   every structured log line.
3. **Level-1 cache** — a `SearchCache` hit (keyed by sha-256 of
   `imageUrl + sorted engineIds`) short-circuits the whole pipeline and
   returns the cached aggregate.
4. **Manager** (`src/adapters/manager.ts`) — consults the `NormalizedCache`
   per engine (key `engineId|imageHash`); only the engines *not* cached are
   routed.
5. **RoutingEngine** (`src/core/router.ts`) — capability negotiation: skip
   engines with no registered adapter or without `supportsUrlInput`, then
   `warmup()`/`initialize()` each adapter once per process and gate on a
   (cached) `healthCheck()`.
6. **ExecutionScheduler** (`src/core/scheduler.ts`) — runs adapter tasks with
   a priority queue, bounded concurrency, per-task timeout, retries, and
   per-engine circuit breakers (see §5, §6).
7. **Adapters** produce `RawSearchResult[]` and `normalize()` them into
   `NormalizedResult[]`.
8. **Normalizer** (`src/core/normalizer.ts`) — defense-in-depth sanitization:
   http(s)-only URLs, control characters stripped, bounded string lengths,
   confidence clamped to 0–1.
9. **Ranker** (`src/core/ranker.ts`) — deduplicate by canonical-URL sha-256
   (keeping the highest-confidence copy), frequency-boost, apply per-engine
   source weights, sort by score, cap at `maxResults`.
10. **Response** — `{ status, request_id, total_results, results, errors }`
    where `errors` carries per-engine failures; a failing adapter never
    aborts the aggregate (partial success). Successful aggregates are stored
    in the `SearchCache`.

## 2. Module map

```
src/
├── index.ts                        # boot, SIGTERM/SIGINT graceful shutdown
├── server.ts                       # Express routes, auth, SSRF, trace headers
├── security.ts                     # SSRF validation (DNS-resolved IP policy)
├── config.ts                       # flat config facade over core/config.ts
├── logging.ts                      # simple JSON log helper (legacy)
├── types.ts                        # shared contracts + error classes
├── cache.ts                        # re-export shim for core/cache.ts
├── core/
│   ├── config.ts                   # layered config provider + defaults
│   ├── registry.ts                 # explicit AdapterRegistry
│   ├── router.ts                   # capability negotiation + per-engine routing
│   ├── scheduler.ts                # priority queue, retries, timeouts, circuit breakers
│   ├── normalizer.ts               # canonicalUrl / hashUrl / sanitizeResult
│   ├── ranker.ts                   # dedup, weights, frequency boost
│   ├── observability.ts            # trace/correlation ids, structured JSON logs
│   └── cache.ts                    # LruTtlCache + Search/Normalized/Health caches
└── adapters/
    ├── base.ts                     # IImageSearchAdapter, helpers (safeUrl, asString…)
    ├── manager.ts                  # registry wiring, executeAdapters, shutdown
    ├── stubs.ts                    # honest unavailable adapters
    ├── bing.ts                     # Bing Visual Search (official API)
    ├── saucenao.ts                 # compatibility re-export
    ├── api/baseApiAdapter.ts       # reusable API base (retries, timeout, injected fetch)
    ├── api/sauceNaoAdapter.ts      # SauceNAO (official API)
    ├── browser/baseBrowserAdapter.ts # Playwright lifecycle + stealth options
    └── browser/googleLensAdapter.ts  # Google Lens DOM automation
```

## 3. Adapter model & lifecycle

Every adapter implements `IImageSearchAdapter` (`src/adapters/base.ts`):

```ts
interface IImageSearchAdapter {
  readonly id: string;               // stable catalog id (matches the FreeBuff registry)
  readonly name: string;
  readonly capabilities: EngineCapability; // supportsUrlInput, integrationType, …
  warmup(): Promise<void>;           // heavy, one-time setup (e.g. launch browser)
  initialize(): Promise<void>;       // per-adapter setup after warmup
  execute(imageUrl: string): Promise<RawSearchResult[]>; // the actual search
  normalize(raw: RawSearchResult[]): NormalizedResult[]; // → uniform shape
  healthCheck(): Promise<boolean>;   // used by router + circuit probe
  cleanup(): Promise<void>;          // release resources on shutdown
}
```

- **`warmup()`/`initialize()`** are called lazily by the `RoutingEngine` the
  first time an adapter is used in a process (tracked in a `WeakSet`) —
  never at registration time.
- **`cleanup()`** is called on graceful shutdown
  (`shutdownAdapters()` from `src/index.ts`) — this is what closes Playwright
  browser contexts.
- **`NormalizedResult`** is the canonical outbound shape:
  `{ source_engine, url, thumbnail?, confidence: 0–1, metadata: { domain, title?, dimensions? } }`.
- Helpers in `base.ts` (`safeUrl`, `asString`, `asConfidence`, `result`,
  `fetchJson`) are the *only* sanctioned ways to build values — they keep
  XSS/SSRF surface small. Use them in new adapters.

Three reusable base classes exist:

| Base | Use when | Provided by |
| --- | --- | --- |
| `BaseApiAdapter` (`api/baseApiAdapter.ts`) | A documented, permitted HTTP API | Injected `fetch`, per-request abort timeout, transient retry classification (408/425/429/5xx), configurable retries/backoff, lifecycle + health defaults |
| `BaseBrowserAdapter` (`browser/baseBrowserAdapter.ts`) | Headless browser automation | Shared Playwright context with detection-mitigation config (viewport, UA, locale, timezone, stealth flags); injectable `browserFactory` for tests; `BrowserBlockedError`/`BrowserNotReadyError` |
| `UnavailableAdapter` (`stubs.ts`) | No permitted integration exists | Always throws `AdapterNotImplementedError`, `healthCheck()` → `false`, `integrationType: "unavailable"` |

> **Honesty rule:** never fabricate results. If an engine cannot be
> implemented, register an unavailable stub and let the scheduler surface a
> structured error. See `tinEyeStub` for the pattern.

## 4. Registry model

`AdapterRegistry` (`src/core/registry.ts`) is an **explicit** registry:

- Adapters register via `registry.register(adapter)` — no filesystem
  scanning, no dynamic module discovery (deliberately: bundlers, serverless,
  and ESM make discovery fragile).
- `register()` validates `id` is non-empty and **throws on duplicate ids**.
- `list()` / `getAdapter(id)` / `has(id)` / `size` are the query surface.
- `manager.adapterFor(id)` falls back to a dynamic `unavailableAdapter(id)`
  for unknown ids, so requests for unregistered engines degrade gracefully.

Registration lives in **one place** — `src/adapters/manager.ts`:

```ts
registry
  .register(new BingVisualAdapter())
  .register(new SauceNaoApiAdapter())
  .register(tinEyeStub)
  .register(new GoogleLensAdapter());
```

Currently registered adapters:

| id | Integration | Requires | Status |
| --- | --- | --- | --- |
| `saucenao` | Official API | `SAUCENAO_API_KEY` | live |
| `bing` | Official API (Bing Visual Search v7) | `BING_VISUAL_SEARCH_API_KEY` | live |
| `google-lens` | Playwright / Chromium | — | live (blocked pages fail gracefully) |
| `tineye` | — | — | honest unavailable stub |

`GET /api/adapters` exposes this roster (id, capabilities, live health) — the
FreeBuff frontend consumes it as its adapter manifest.

## 5. Scheduler behavior

`ExecutionScheduler` (`src/core/scheduler.ts`):

- **Priority queue** — `user_requested` (0) → `recommended` (1) → `optional`
  (2). Queue is sorted by priority then FIFO sequence; higher-priority tasks
  inserted later still run first.
- **Bounded concurrency** — `policies.maxConcurrency` (default 12, max 15).
  The drain loop releases one slot per completion, so slow adapters never
  starve the queue.
- **Per-task timeout** — `policies.adapterTimeoutMs` (default 15 000 ms),
  enforced via `Promise.race`; a timeout rejects with `SchedulerTimeoutError`.
- **Retries** — `policies.maxRetries` (default 2) → up to 3 attempts total.
  `AdapterNotImplementedError` is never retried.
- **Cancellation** — an `AbortSignal` on the task short-circuits queued work
  and races in-flight work; aborted tasks resolve as `cancelled`.
- **Partial completion** — tasks settle independently; results are aggregated
  per engine. Outcome statuses: `fulfilled | rejected | cancelled |
  circuit_open`.
- `stop()` drains pending queue entries as `cancelled`; `circuitSnapshot()`
  exposes breaker state for observability (logged as `circuit_trips`).

## 6. Circuit breaker

Per-adapter breaker inside the scheduler, keyed by adapter id:

```
closed ──(failures ≥ threshold)──▶ open ──(reset timeout elapsed)──▶ half-open
  ▲                                                                     │
  └──────────────────(probe succeeds)◀──────────────────────────────────┘
```

- **closed** — normal execution.
- **open** — after `policies.circuitFailureThreshold` consecutive failures
  (default 3), the adapter is skipped entirely; tasks resolve as
  `circuit_open`.
- **half-open** — after `policies.circuitResetTimeoutMs` (default 30 000 ms)
  the breaker allows exactly **one probe** (`probeInFlight`). Probe success
  closes the breaker and resets the failure count; probe failure re-opens it.
- `recordHealth(adapterId, healthy)` lets background health probes drive the
  same state machine; **`AdapterNotImplementedError` never counts as a
  breaker failure** (unavailable stubs must not trip real circuits).
- A healthy adapter resets its failure count to 0 on every success.

## 7. Caching strategy

One bounded LRU-with-TTL primitive (`LruTtlCache` in `core/cache.ts`) backs
three distinct levels:

| Cache | Key | TTL (default) | Purpose |
| --- | --- | --- | --- |
| `SearchCache` | sha-256 of `imageUrl\n<sorted engineIds>` | 300 000 ms (5 min) | Full aggregate responses; level-1 short-circuit in `server.ts` |
| `NormalizedCache` | `engineId|imageHash` | 300 000 ms | Per-engine normalized results; level-2 in `manager.ts` (only uncached engines are routed) |
| `HealthCache` | adapter id | 30 000 ms | Adapter health snapshots so healthy adapters aren't re-probed per request |

Eviction: LRU on overflow (`maxEntries`, default 64 for search/normalized, 64
for health), TTL expiry on read. All caches are **in-memory only** — nothing
is persisted.

## 8. Normalizer & ranking

- **Normalizer** (`core/normalizer.ts`): `canonicalUrl()` strips fragments and
  tracking params (`utm_*`, `fbclid`, `gclid`, `ref`, `spm`, …), lowercases
  the host; `hashUrl()` is the stable sha-256 used for dedup; `sanitizeResult()`
  is idempotent defense-in-depth (rejects non-http(s), strips control chars,
  caps lengths, clamps confidence, rebuilds metadata).
- **Ranker** (`core/ranker.ts`): dedupe by URL hash keeping the
  highest-confidence copy → frequency boost (`+0.1` per extra engine that
  found the URL, capped at 1.0) → per-engine source weights (optional JSON
  config `weights`, default 1.0) → sort by score desc → slice `maxResults`
  (default 500).

## 9. Configuration layering

`core/config.ts` implements `Defaults ← JSON config ← environment variables`:

1. `DEFAULT_CONFIG` (in-code defaults),
2. `RIS_CONFIG_PATH` JSON file (e.g. `{ "weights": { "saucenao": 1.2 } }`),
3. environment variables (see `ENV.example` for the full list).

All operational policy values are configurable here — **never hardcoded in
call sites**:

| Policy | Env | Default | Cap |
| --- | --- | --- | --- |
| concurrency | `RIS_MAX_CONCURRENCY` | 12 | 15 |
| adapter timeout | `RIS_ADAPTER_TIMEOUT_MS` | 15 000 | 15 000 |
| retries | `RIS_MAX_RETRIES` | 2 | 2 |
| cache TTL / entries | `RIS_CACHE_TTL_MS` / `RIS_CACHE_MAX_ENTRIES` | 300 000 / 64 | — / 512 |
| circuit threshold / reset | `RIS_CIRCUIT_FAILURE_THRESHOLD` / `RIS_CIRCUIT_RESET_TIMEOUT_MS` | 3 / 30 000 | 100 / — |
| health probe timeout | `RIS_HEALTH_PROBE_TIMEOUT_MS` | 5 000 | — |
| max results | `RIS_MAX_RESULTS` | 500 | 2 000 |

## 10. Security

- **SSRF** (`security.ts`) — only `http:`/`https:`, no userinfo, DNS lookup
  with rejection of private/loopback/link-local/metadata/multicast/reserved
  IPv4 + IPv6 ranges (incl. `::ffff:`-mapped and `2001:db8::/32`).
- **Auth** — timing-safe `Buffer` comparison of the bearer token.
- **Bounds** — 32 KB JSON body cap; ≤ 518 engine ids; URL length 8–4096.
- **Sanitization** — all outbound URLs/text are bounded and http(s)-only.
- **Credential isolation** — logs never include URLs, tokens, or upstream
  payloads; adapter keys live only in config secrets.

## 11. Observability

`core/observability.ts` — `newTraceId()`/`newCorrelationId()` (UUIDs) per
request; `createLogger(context)` emits one JSON object per line with
`timestamp`, `service`, trace/correlation ids, and event fields (`cache_hit`,
`request_complete`, `aggregate_complete`, `circuit_trips`, latency, failures).
Parsable by any JSON log pipeline (Datadog, CloudWatch, …).

## 12. Non-goals (from the spec, still honored)

- No hundreds of providers on day one — adapters are added incrementally and
  only where a permitted integration path exists.
- No fake stubs — unavailable engines error honestly.
- No bypassing auth systems, no provider-specific workarounds in core logic,
  no optimizing for coverage before architecture.
