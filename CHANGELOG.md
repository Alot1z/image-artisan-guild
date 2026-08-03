# Changelog

> **Source note**: git history is managed by the hosting platform (VCS
> commands are blocked in the dev sandbox), so this changelog is derived from
> the current code, the CI workflow, and the proxy's own changelog
> (`proxy/CHANGELOG.md` — proxy-scoped). Entries below list only what is
> verifiable in the repository today. The proxy package has its own
> `proxy/CHANGELOG.md` with phase-by-phase detail for `0.1.0`.

## [Unreleased]

### In progress (present in code, incomplete by design)

- **518-entry contract catalog** — `src/lib/engines.ts` generates exactly 518
  registry rows (55 verified seeds + locale/proxy-lane variants), but only 4
  ids have adapters on the proxy (`bing`, `saucenao`, `google-lens`, and the
  `tineye` stub). All other ids return honest "unavailable" errors.
- **TinEye adapter** — registered as `UnavailableAdapter` stub
  (`proxy/src/adapters/stubs.ts`); needs a permitted account-specific API
  integration (`TINEYE_API_KEY`/`TINEYE_API_URL` placeholders exist in
  `proxy/ENV.example`).
- **`enginesManifest` / status sync** — frontend fetches the proxy's adapter
  manifest on mount (`src/convex/aggregate.ts` → `Engines.tsx` "Live/Planned"
  chips). Depends on a live `RIS_PROXY_URL`; falls back silently to "planned".
- **Exa semantic search** — `src/convex/exa.ts` requires `EXA_API_KEY` (not
  present in code); without it the action returns `missing-key`.

### Planned / open items

- Frontend test suite (none exists; type gate is `tsc` only).
- CI typecheck of the frontend (blocked: `src/convex/_generated/` is
  gitignored and Convex has no offline codegen).
- Wiring `RequireAuth` around `/dashboard` and the unused `Dashboard` page
  (`src/pages/Dashboard.tsx` — no route references it today).

## [0.1.0] — 2026-08-03 — Initial platform foundation

### Frontend (Freebuff · Vite + React + Convex)

- **Vintage workbench** — Landing, Auth (email OTP + anonymous, Freebuff
  custom-JWT), and the Inquisitor workbench at `/dashboard` with a sepia /
  aged-paper design system (`src/index.css`).
- **Five modes of receipt** — camera, gallery, web URL, files, clipboard +
  drag-and-drop and paste-anywhere (`src/components/inquisitor/InputHub.tsx`,
  `src/pages/Inquisitor.tsx`).
- **Image analysis** — EXIF reader with GPS (`src/lib/exif.ts`), k-means
  palette (`src/lib/palette.ts`), aHash perceptual hash (`src/lib/phash.ts`),
  format conversion (`src/lib/format.ts`), cropper with presets
  (`src/components/inquisitor/Cropper.tsx`), OCR via Tesseract.js
  (Sidebar "OCR Lantern").
- **Engine catalogue** — tier-grouped 518-entry registry with search,
  region/availability filters, "Engage every index" mass selection, and
  GPS-driven regional auto-ticking (`src/lib/engines.ts`,
  `src/lib/region.ts`, `src/components/inquisitor/Engines.tsx`).
- **Search pipeline** — `SearchPhase` state machine, aggregate results grid,
  partial-error chips, failure notices, crop-re-dispatches
  (`src/pages/Inquisitor.tsx`, `src/lib/proxyTypes.ts`).
- **Privacy-first history** — IndexedDB + localStorage, never Convex
  (`src/lib/history.ts`, `src/lib/inquiry-store.ts`).

### Convex backend

- Auth tables + `users` table (`src/convex/schema.ts`, `auth.ts`,
  `auth.config.ts`, `http.ts`).
- Ephemeral image hosting — `storeImage` action + `hostedImages` registry
  with 24 h TTL (`src/convex/inquiries.ts`) and a 6-hourly purge cron
  (`src/convex/crons.ts`).
- External proxy dispatch — `dispatchAggregateSearch` internal action,
  `aggregateSearch` public wrapper, `enginesManifest` adapter-status action,
  all with failure classification and sanitization (`src/convex/aggregate.ts`).
- Text research — Exa semantic search action (`src/convex/exa.ts`) and the
  self-hosted multi-source Web Census (`src/convex/census.ts`: DuckDuckGo,
  Wikipedia, OpenAlex, Internet Archive, Open Library, GitHub).

### RIS External Proxy (`proxy/`, v0.1.0)

- Express 5 server with `POST /api/aggregate-search`, `GET /api/adapters`,
  `GET /health`; timing-safe bearer auth; 32 KB body limit
  (`proxy/src/server.ts`).
- DNS-resolved SSRF protection (`proxy/src/security.ts`).
- Layered config `Defaults ← JSON ← env` (`proxy/src/core/config.ts`).
- Explicit `AdapterRegistry` (no filesystem scanning),
  `RoutingEngine` capability negotiation, `ExecutionScheduler` priority queue
  with per-task timeout, retries, cancellation, and circuit breakers
  (closed/open/half-open) (`proxy/src/core/`).
- Three LRU+TTL cache levels — `SearchCache`, `NormalizedCache`,
  `HealthCache` (`proxy/src/core/cache.ts`).
- Normalizer (canonical URL hashing, sanitization) and ranking engine
  (dedupe, confidence clamp, source weights, frequency boost)
  (`proxy/src/core/normalizer.ts`, `ranker.ts`).
- Adapters: Bing Visual (official API), SauceNAO (official API, retrying
  `BaseApiAdapter`), Google Lens (Playwright browser adapter with
  `BrowserBlockedError` handling), TinEye (unavailable stub)
  (`proxy/src/adapters/`).
- Trace/correlation observability with structured JSON logging and
  credential isolation (`proxy/src/core/observability.ts`, `logging.ts`).
- Deployment — Playwright-based `Dockerfile` (non-root, healthcheck),
  `render.yaml`, `fly.toml`, `ENV.example`.
- Tests — 6 suites / 33 tests: server contract, core, saucenao, googleLens,
  pipeline, and a full end-to-end integration test (`proxy/tests/`).

### CI & release tooling

- `.github/workflows/ci.yml` — proxy `install --frozen-lockfile → build →
  test` job and a Docker build + container smoke-test job.
- Platform docs: `docs/` wiki (Architecture, Adding Services, API Reference,
  Privacy, vintage design system) and proxy-scoped developer docs
  (`proxy/ARCHITECTURE.md`, `proxy/CONTRIBUTING.md`, `proxy/CHANGELOG.md`).
