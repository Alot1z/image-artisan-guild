# Architecture — Image Inquisitor + RIS External Proxy

> Platform-wide engineering architecture, written from the current codebase
> (repo root + `proxy/`). Every claim cites its implementation location.
> Anything not verifiable from code is marked `[Unverified]` or `[Unknown]`.

---

## 1. System overview & component boundaries

The platform is **two deployables**:

| Deployable | Location | Stack | Role |
| --- | --- | --- | --- |
| **FreeBuff frontend** ("The Image Inquisitor") | repo root (`src/`) | Vite 7 · React 19 · TypeScript · Tailwind 4 · Convex | Vintage-styled image-intelligence workbench (PWA). Owns input, analysis (EXIF/palette/hash/OCR), history, and the search dispatch UI. |
| **RIS External Proxy** | `proxy/` | Node.js ≥ 20 · Express 5 · TypeScript ESM · Playwright · p-limit | Headless reverse-image-search aggregation gateway. Owns all adapter integrations, executes searches, normalizes, deduplicates, ranks. |

Supporting infra:

- **Convex backend** (within the frontend repo, `src/convex/`): auth, ephemeral image hosting with a 24 h TTL cron, and secure server-side calls to the proxy (`src/convex/aggregate.ts`).
- **CI**: `.github/workflows/ci.yml` — proxy build/tests job + Docker build/smoke-test job.
- **Wiki/docs**: `docs/` (product wiki) and `proxy/ARCHITECTURE.md` / `proxy/CONTRIBUTING.md` / `proxy/CHANGELOG.md` (proxy-scoped developer docs).

### Data flow (one search)

```mermaid
flowchart LR
    A[Workbench: camera/gallery/URL/clipboard] --> B[useInquiryStore]
    B --> C[Convex storeImage action]
    C --> D[(Convex storage blob · 24h TTL)]
    D --> E[Convex aggregateSearch action]
    E -->|Bearer RIS_PROXY_KEY| F[POST /api/aggregate-search]
    F --> G[SSRF + auth validation]
    G --> H[RoutingEngine → ExecutionScheduler]
    H --> I[AdapterRegistry: bing · saucenao · google-lens · tineye-stub]
    I --> J[Normalizer → RankingEngine]
    J --> F
    F -->|ranked JSON + errors| E
    E --> K[SearchPhase state machine → results grid]
```

End to end: the browser sends a base64 blob to the Convex action
`storeImage` (`src/convex/inquiries.ts`), which stores it in Convex storage
and returns a public URL. The workbench then calls the Convex action
`aggregateSearch` (`src/convex/aggregate.ts`), which POSTs
`{ imageUrl, engineIds }` to the proxy with a bearer key read **only** from
server-side env (`RIS_PROXY_KEY`). The proxy validates, executes adapters,
normalizes/ranks, and returns one unified payload; the Convex action maps it
to UI types and returns it to the browser. **No results are persisted in
Convex** — the hosted blob is swept after 24 h by a 6-hourly cron
(`src/convex/crons.ts`).

---

## 2. Repository map

```
repo root (FreeBuff frontend)
├── src/
│   ├── main.tsx                  # bootstrap: Convex client, router, error boundaries, PWA SW
│   ├── index.css                 # Tailwind 4 + Vintage sepia theme tokens
│   ├── convex/                   # Convex backend (auth, hosting, proxy dispatch, Exa, census)
│   ├── components/inquisitor/    # Workbench UI (Engines, Preview, InputHub, History, Cropper, Sidebar)
│   ├── components/ui/            # shadcn/ui primitives
│   ├── pages/                    # Landing, Auth, Inquisitor, NotFound (+ unused Dashboard)
│   ├── lib/                      # engines registry, proxyTypes, store, history, exif, palette, phash…
│   └── hooks/use-auth.ts         # auth hook wrapping Convex Auth
├── docs/                         # product wiki (Architecture, Adding Services, API Reference, Privacy…)
├── .github/workflows/ci.yml      # proxy CI + Docker job
├── public/                       # sw.js (PWA), manifest.webmanifest
└── README.md                     # product readme with mermaid data-flow
proxy/                            # RIS External Proxy (standalone deployable)
├── src/
│   ├── server.ts                 # Express app: /health, /api/adapters, /api/aggregate-search
│   ├── index.ts                  # listen + graceful shutdown
│   ├── security.ts               # DNS-resolved SSRF validation
│   ├── config.ts / core/config.ts# layered config (Defaults ← JSON ← env)
│   ├── core/                     # registry, scheduler, router, cache, normalizer, ranker, observability
│   ├── adapters/                 # base, api/, browser/, stubs, manager
│   └── types.ts / logging.ts
├── tests/                        # 6 suites + setup.ts (33 tests)
├── Dockerfile · render.yaml · fly.toml · ENV.example
└── README.md / ARCHITECTURE.md / CONTRIBUTING.md / CHANGELOG.md
```

---

## 3. Frontend architecture

- **Boot** (`src/main.tsx`): `ConvexReactClient(import.meta.env.VITE_CONVEX_URL)`
  inside `ConvexAuthProvider` (`@convex-dev/auth/react`), `BrowserRouter`
  routes: `/` Landing, `/auth` Auth, `/dashboard` **Inquisitor**, `*`
  NotFound. Routes are lazy-loaded with `Suspense`. A service worker is
  registered from `/sw.js` (PWA). `RootErrorBoundary` + `ToolbarErrorBoundary`
  keep runtime errors from blanking the preview.
- **Routing note** `[Observed]`: `src/components/RequireAuth.tsx` exists and
  redirects unauthenticated users to `/auth?returnTo=…`, but a codebase grep
  shows **no route currently wraps it** — `/dashboard` is not gated. The
  `Dashboard` page (`src/pages/Dashboard.tsx`) is not referenced by any route.
- **State**: `src/lib/inquiry-store.ts` — a `useInquiryStore()` hook holds
  `assets[]` (each an `InquiryAsset` with blob, EXIF, palette, hash, engines),
  `hostedUrls`, `history`, and actions (`add`, `addFromUrl`, `setEngines`,
  `replaceAsset`, `recordAll`…). **Every new asset defaults its engines to
  `[...ALL_ENGINE_IDS]` (all 518)** — see `engines: [...ALL_ENGINE_IDS]`.
- **Engine registry** (`src/lib/engines.ts`, 749 lines):
  - 55 verified seed engines (`Engine` objects: `google-lens`, `bing`,
    `yandex`, `tineye`, …) with tier (1–4), region, feature, availability.
  - `EngineRegistryEntry` contract rows `{ id, name, tier, region, supported }`.
  - `EngineRegistry` = seeds + **generated variants** (per-locale
    `seed-locale` ids and `seed-proxy-N` lanes) padded to **exactly 518**
    entries; `supported: false` marks generated rows.
  - `ENGINES` maps registry rows back to UI `Engine`s with `mode: "proxy"`
    (all dispatch through the proxy contract).
- **Search execution** (`src/pages/Inquisitor.tsx`): strict phase machine
  `SearchPhase` = `idle → uploading → searching → processing → complete`
  (or `failed`), defined in `src/lib/proxyTypes.ts`. Failures are classified
  (`missing-config | auth-failed | rate-limited | proxy-error |
  invalid-response`) and surfaced as a non-blocking vintage notice; partial
  engine errors render as chips. Cropping replaces the asset and immediately
  re-dispatches (`handleCropped`).
- **Analysis tooling** (client-side, no network): EXIF reader
  (`src/lib/exif.ts`), k-means palette (`src/lib/palette.ts`), aHash
  perceptual hash (`src/lib/phash.ts`), format conversion
  (`src/lib/format.ts`), image utils (`src/lib/image-utils.ts`). OCR via
  lazy-loaded Tesseract.js in `Sidebar.tsx` ("OCR Lantern").
- **History & privacy**: `src/lib/history.ts` keeps history in **IndexedDB**
  (blobs) + localStorage (metadata) — never in Convex.
- **Theme**: `src/index.css` defines the Vintage sepia/aged-paper token set
  (`--brass`, `--seal`, `--ink`, `--paper-tint`…); `Preview.tsx`
  (`applyTintFromPalette`) live-tints `--brass`/`--seal` from the active
  image's dominant swatch.

---

## 4. Backend (Convex)

`src/convex/` — all secrets are read from server-side env only.

- **Schema** (`src/convex/schema.ts`): `users` (name/image/email/role) via
  `authTables`, plus `hostedImages` (`storageId`, `bytes`, `fileName`,
  `createdAt`, index `by_createdAt`). `schemaValidation: false`.
- **Auth** (`src/convex/auth.ts`, `auth.config.ts`, `http.ts`): Convex Auth
  with `emailOtp` + `Anonymous` providers and a `customJwt` for the Freebuff
  issuer (`VLY_CONVEX_AUTH_ISSUER` / JWKS). `src/hooks/use-auth.ts` exposes
  `{ isLoading, isAuthenticated, user, signIn, signOut }`.
- **Ephemeral image hosting** (`src/convex/inquiries.ts`): `storeImage`
  action (base64 → `ctx.storage.store` → `recordHosted` row),
  `purgeHostedImages` internal action sweeping rows older than
  `HOSTED_TTL_MS` (24 h). `src/convex/crons.ts` runs it **every 6 hours**.
  `recentInquiries` returns privacy-scrubbed metadata only.
- **Proxy dispatch** (`src/convex/aggregate.ts`, `"use node"`):
  - `dispatchAggregateSearch` (internalAction) — POSTs to
    `RIS_PROXY_URL` with `Authorization: Bearer RIS_PROXY_KEY`; classifies
    401/403 → `auth-failed`, 429 → `rate-limited`, other non-OK → `proxy-error`,
    bad JSON → `invalid-response`; normalizes the proxy's `results`/`matches`
    array and sanitizes the per-engine `errors` array.
  - `aggregateSearch` (public action) — thin wrapper calling the internal
    action (keeps the adapter implementation internal).
  - `enginesManifest` (public action) — GETs `{base}/api/adapters` (derived
    from `RIS_PROXY_URL` via `manifestEndpointFor`) and maps adapter rows to
    `EngineManifestEntry` (`active` vs `planned` by `integrationType`).
- **Text research**:
  - `src/convex/exa.ts` — `exaSearch` action fronting the Exa API
    (`EXA_API_KEY` server-side only). Used as the "Semantic Registry".
  - `src/convex/census.ts` — `webCensus` action: self-hosted multi-source
    fan-out (DuckDuckGo HTML, Wikipedia REST, OpenAlex, Internet Archive,
    Open Library, GitHub code) with cheerio parsing, dedupe + weighted merge.
    No third-party keys required.

---

## 5. Proxy architecture (RIS External Proxy)

Pipeline (per `proxy/README.md` and `proxy/src/server.ts`):

`Request → Validation → Capability Negotiation → Routing Engine → Execution Scheduler → Explicit Provider Registry → Adapters → Normalizer → Ranking Engine → Response`

### 5.1 HTTP surface (`proxy/src/server.ts`)

- `POST /api/aggregate-search` — body `{ imageUrl, engineIds }`, 32 KB limit;
  requires `Authorization: Bearer <RIS_PROXY_KEY>` compared with
  `crypto.timingSafeEqual`; emits `x-request-id`, `x-trace-id`,
  `x-correlation-id`; consults the level-1 `SearchCache`; responds with
  `{ status, request_id, total_results, results, errors }`.
- `GET /api/adapters` — **public** (no auth check in `server.ts`): lists
  registered adapters with `capabilities` + live `healthCheck()`.
- `GET /health` — unauthenticated liveness (`{ status, cache_entries }`),
  used by the Docker `HEALTHCHECK` and render/fly health checks.
- Error middleware: 413 `entity.too.large`, else 500.

### 5.2 Security (`proxy/src/security.ts`)

`validatePublicImageUrl` — requires http(s), no embedded credentials, rejects
`localhost`/`.local`/`.internal`, blocks private/loopback/link-local/metadata
IPv4+IPv6 ranges, and **resolves DNS** (`dns.lookup` with `all: true`) —
every resolved address must be public.

### 5.3 Core systems (`proxy/src/core/`)

| Module | Responsibility | Evidence |
| --- | --- | --- |
| `config.ts` | Layered config `Defaults ← JSON (RIS_CONFIG_PATH) ← env` with clamps (concurrency ≤ 15, timeout ≤ 15 s, retries ≤ 2, cache 64/5 min…); `proxyConfig` singleton | `loadConfig()`, `mergeSources()` |
| `registry.ts` | `AdapterRegistry` — explicit `register()`, duplicate-id throws, no filesystem scanning | `class AdapterRegistry` |
| `scheduler.ts` | `ExecutionScheduler` — priority queue (`user_requested` → `recommended` → `optional`), `maxConcurrency`, per-task timeout (15 s), retries (≤ 2), **circuit breaker** closed/open/half-open (threshold 3, reset 30 s, single probe), cancellation, `fulfilled/rejected/cancelled/circuit_open` outcomes | `submit`, `runWithPolicy`, `canRun` |
| `router.ts` | `RoutingEngine` — capability negotiation (`supportsUrlInput`), lazy `warmup()+initialize()` once per adapter, `healthCheck()` through `HealthCache`, per-engine result buckets | `route()`, `prepare()` |
| `cache.ts` | `LruTtlCache` base + three levels: `SearchCache` (aggregate responses), `NormalizedCache` (per-engine `engineId|imageHash`), `HealthCache` (30 s TTL) | class defs |
| `normalizer.ts` | `canonicalUrl` (strip fragment/tracking params), `hashUrl` (sha-256), `sanitizeResult` (reject non-http, strip control chars, cap lengths, clamp confidence) | exports |
| `ranker.ts` | `rankResults` — dedupe by URL hash keeping highest confidence, frequency boost (+0.1 per extra engine), configurable per-engine `weights`, stable score sort, `maxResults` | `RankOptions` |
| `observability.ts` | `newTraceId`/`newCorrelationId` (UUIDs), `createLogger` — structured JSON logs (`timestamp`, `service`, trace context) with credential isolation | exports |

### 5.4 Adapter model (`proxy/src/adapters/`)

Interface `IImageSearchAdapter` (`base.ts` / `types.ts`): lifecycle
`warmup() → initialize() → execute(imageUrl) → normalize(raw) → healthCheck()`
+ `cleanup()`, with `capabilities` (`supportsImageUpload`, `supportsUrlInput`,
`requiresAuth`, `integrationType`).

**Registered adapters** (the only ones the proxy can execute, registered in
`manager.ts`):

| id | Name | Integration | Capabilities | Notes |
| --- | --- | --- | --- | --- |
| `bing` | Bing Visual Search | `official_api` | upload+url, auth | POST to `BING_VISUAL_SEARCH_ENDPOINT` with `Ocp-Apim-Subscription-Key` (`bing.ts`) |
| `saucenao` | SauceNAO | `official_api` | upload+url, auth | GET `saucenao.com/search.php` with `api_key`; parses `ext_urls` (`api/sauceNaoAdapter.ts`, `BaseApiAdapter`) |
| `google-lens` | Google Lens | `playwright` | url (browser) | Playwright Chromium; upload-by-URL; `BrowserBlockedError` on captcha/block; `unwrapGoogleUrl` redirects (`browser/googleLensAdapter.ts`) |
| `tineye` | TinEye | `unavailable` | upload, auth | **Stub** — `UnavailableAdapter` throws `AdapterNotImplementedError` (`stubs.ts`). No fake results. |

`manager.ts` also exports `adapterFor(id)` which falls back to
`unavailableAdapter(id)` for any unregistered id, and `executeAdapters()`
which serves `NormalizedCache` hits, routes the remainder, sanitizes,
writes back to the cache, and ranks.

**Honesty rule**: adapters never fabricate results. Unregistered/unavailable
ids return a typed `AdapterNotImplementedError` that the scheduler treats as
non-fatal (no retry, no circuit trip) and the server surfaces as a per-engine
error (`logging.ts::safeAdapterError`).

---

## 6. API contracts

### Frontend ↔ Convex (`src/lib/proxyTypes.ts`)

- `AggregateSearchRequest { imageUrl: string; engineIds: string[] }`
- `AggregateDispatchResult` — `{ ok: true, searchedAt, serviceCount, results: AggregateResult[], errors: ProxyEngineError[] }` | `{ ok: false, error: AggregateFailureKind, status?, serviceCount, results: [] }`
- `AggregateResult { id, title, sourceUrl, imageUrl?, thumbnailUrl?, width?, height?, score?, matchType?, services? }`
- `EngineManifestResult` — `{ ok: true, entries: EngineManifestEntry[] }` | `{ ok: false, error }`; `EngineManifestEntry { id, name, status: "active"|"planned", healthy?, integrationType? }`
- `SearchPhase` — `"idle" | "uploading" | "searching" | "processing" | "complete" | "failed"`

### Convex ↔ Proxy (wire contract)

`POST {proxyUrl}` body: `{ "imageUrl": "<hosted URL>", "engineIds": ["bing", …] }`
→ 200 `{ "status": "success", "request_id", "total_results", "results": [SearchResult…], "errors": [{engine_id, error}…] }`
(accepts `results` or `matches`). Convex also accepts `image_url`/`engine_ids`
aliases server-side, and the proxy tolerates `image_url`/`engine_ids` request
aliases (`server.ts`). 401/403/429/5xx are classified per §4.

`GET {base}/api/adapters` → `{ "adapters": [{ id, name, capabilities, healthy }] }`
(payload shape consumed by `enginesManifest`; `healthy` is `boolean`).

---

## 7. Authentication, security & secrets

- **User auth (frontend)**: Convex Auth — email OTP + anonymous, plus
  Freebuff custom-JWT (`src/convex/auth.config.ts`). `/dashboard` is not
  currently gated by `RequireAuth` `[Observed]`.
- **Proxy auth**: shared-secret bearer (`RIS_PROXY_KEY`), timing-safe compare.
- **Secret isolation**: `RIS_PROXY_URL`, `RIS_PROXY_KEY`, `EXA_API_KEY` are
  read from `process.env` inside `"use node"` Convex actions only; they never
  reach the browser bundle (no `VITE_` secrets; verified by audit greps in
  prior work). Proxy adapter keys (`SAUCENAO_API_KEY`,
  `BING_VISUAL_SEARCH_API_KEY`, `TINEYE_API_KEY`) stay in proxy env /
  `ENV.example` only.
- **Input hardening**: 32 KB body limit, `engineIds` 1–518 strings ≤ 160 chars
  (`server.ts::parseEngineIds`), DNS-resolved SSRF rejection
  (`security.ts`), URL sanitization + control-char stripping
  (`core/normalizer.ts`), credential-free logs (`core/observability.ts`,
  `logging.ts`).

---

## 8. State management & caching

| Layer | What | Where | Lifetime |
| --- | --- | --- | --- |
| Browser IndexedDB | inquiry history (blobs) | `src/lib/history.ts` | forever (user-managed) |
| Browser localStorage | history metadata/favorites | `src/lib/history.ts` | forever |
| Convex `hostedImages` | upload registry (blob in Convex storage) | `src/convex/inquiries.ts` | **24 h TTL**, swept 6-hourly cron |
| Proxy `SearchCache` | full aggregate responses | `proxy/src/core/cache.ts` | 5 min / 64 entries |
| Proxy `NormalizedCache` | per-engine results | same | 5 min / 64 entries |
| Proxy `HealthCache` | adapter health snapshots | same | 30 s |

---

## 9. Testing strategy

- **Frontend**: no test suite configured (package.json has lint/build only);
  correctness gate is `bun tsc -b --noEmit` + `bun convex dev --once`
  (codegen). `[Unverified: no frontend unit/integration tests]`.
- **Proxy** (`proxy/tests/`, run with `bun run test` — the script injects the
  test env prefix because bare `bun test` skips package scripts):
  - `server.test.ts` — HTTP contract (auth, SSRF, unavailable errors,
    adapters manifest, health).
  - `core.test.ts` — config layering, scheduler circuits, router priority.
  - `saucenao.test.ts`, `googleLens.test.ts` — adapter unit behavior with
    injected fakes.
  - `pipeline.test.ts` — ranker/normalizer/cache/observability units.
  - `integration.test.ts` — full pipeline: auth → routing → scheduling →
    (mocked) adapters → normalization → ranking → response; cache paths.
  - `setup.ts` — shared upstream fetch dispatcher for cross-file mocking.
- **CI** (`.github/workflows/ci.yml`): job 1 = proxy `bun install --frozen-lockfile
  → build → test` (Bun 1.3.14); job 2 = Docker build + container smoke test
  (health + aggregate-search contract) — Docker isn't installed in the dev
  sandbox, so image build is only validated in CI `[Unverified locally]`.

---

## 10. Deployment architecture

- **Proxy**: Docker (`proxy/Dockerfile`) based on the official Playwright
  image (`mcr.microsoft.com/playwright:v1.62.0-noble` — ships Chromium + OS
  deps), non-root `proxyuser`, `HEALTHCHECK` on `/health`, compiled to
  `dist/` with dev deps pruned. Render (`proxy/render.yaml`, docker context
  `./proxy`) and Fly.io (`proxy/fly.toml`, same context) configs included.
  Env contract in `proxy/ENV.example`.
- **Frontend**: static Vite build hosted by the platform (Freebuff); Convex
  deployment provides the backend + `VITE_CONVEX_URL`.
- **Secrets**: set in the platform Keys tab (frontend: `RIS_PROXY_URL`,
  `RIS_PROXY_KEY`, `EXA_API_KEY`; proxy: `RIS_PROXY_KEY`,
  `SAUCENAO_API_KEY`, `BING_VISUAL_SEARCH_API_KEY`, …).

---

## 11. Known gaps & honest limitations

- Only **4 of 518** catalog ids have proxy adapters; the rest return honest
  "unavailable" errors until adapters are added (see `proxy/CONTRIBUTING.md`
  and ROADMAP.md).
- `/dashboard` auth gating and `Dashboard.tsx` are defined but not wired
  `[Observed]`.
- `src/convex/_generated/` is gitignored; Convex 1.30 has no offline codegen,
  so CI cannot typecheck the frontend without deployment credentials.
- Git history is managed by the hosting platform (VCS commands blocked in the
  sandbox) — CHANGELOG.md is therefore code/CI-derived, not git-derived.
