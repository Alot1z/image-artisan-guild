# Changelog

All notable changes to the RIS External Proxy are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Additional official-API adapters as permitted integrations become available.
- Background health-probe loop for circuit-breaker recovery (`half-open`
  probing is currently on-demand via the scheduler).
- Optional shared cache backing (Redis) for horizontal scaling — the three
  in-memory caches are process-local today.

## [0.1.0] — 2026-08-03

Initial release: the full 5-phase architecture build, CI, and deployment
config. **33 tests passing.**

### Phase 1 — Framework & initial adapters

- Express + TypeScript server (`src/server.ts`, `src/index.ts`) with:
  - `POST /api/aggregate-search` — timing-safe bearer auth, 32 KB body cap,
    ≤ 518 engine ids, DNS-resolved SSRF validation (`src/security.ts`).
  - `GET /health` (unauthenticated liveness) and `GET /api/adapters`
    (adapter manifest: id, capabilities, live health).
  - `x-trace-id` / `x-correlation-id` / `x-request-id` headers.
- Layered configuration provider (`src/core/config.ts`):
  `Defaults ← JSON config (RIS_CONFIG_PATH) ← environment variables`.
- Explicit `AdapterRegistry` (`src/core/registry.ts`) — no filesystem
  scanning; duplicate ids rejected.
- `ExecutionScheduler` (`src/core/scheduler.ts`) — priority queue
  (`user_requested → recommended → optional`), bounded concurrency,
  per-task timeout, retries, cancellation, and per-adapter circuit breakers
  (closed → open → half-open with single-probe recovery).
- `RoutingEngine` (`src/core/router.ts`) — capability negotiation, lazy
  `warmup()`/`initialize()` per adapter, health-gated execution.
- Initial adapters: **Bing Visual Search** (official API), honest
  **TinEye unavailable stub**, plus dynamic unavailable stubs for every other
  catalog id. No fabricated results.

### Phase 2 — Reusable API adapters

- `src/adapters/api/baseApiAdapter.ts` — reusable API base: injected `fetch`,
  per-request `AbortController` timeout, transient-status retry
  (408/425/429/5xx) with backoff, lifecycle + health defaults.
- `src/adapters/api/sauceNaoAdapter.ts` — SauceNAO official API
  (`SAUCENAO_API_KEY`, `output_type=2`, `numres=30`), normalized to the
  uniform result contract incl. `dimensions` metadata.
- Fixed a normalization defect found by the new tests: numeric EXIF-style
  `width`/`height` values are stringified before sanitization.
- Fetch-mocked test suite for request construction, normalization, retries,
  and scheduler timeout policy.

### Phase 3 — Browser automation adapters

- `src/adapters/browser/baseBrowserAdapter.ts` — Playwright lifecycle:
  idempotent `warmup()` (shared Chromium context), `cleanup()` on graceful
  shutdown, detection-mitigation config (headless, viewport, UA, locale,
  timezone, stealth flags), injectable `browserFactory` for tests.
- `src/adapters/browser/googleLensAdapter.ts` — Google Lens automation:
  configurable upload URL, results-DOM scraping, redirect unwrapping, chrome
  link filtering, position-based confidence. Blocked pages throw
  `BrowserBlockedError` → scheduler → circuit breaker opens; empty pages
  return `[]` honestly.
- Added `shutdownAdapters()` so `SIGTERM`/`SIGINT` close browser contexts.
- Browser-mocked test suite (scraping/normalization, blocked-page circuit
  trip, no-results, helpers, registration).

### Phase 4 — Pipeline completion

- `src/core/normalizer.ts` — canonical-URL hashing (fragments + tracking
  params stripped), stable sha-256 dedup keys, idempotent response
  sanitization (http(s)-only, control chars stripped, bounded lengths,
  confidence clamped).
- `src/core/ranker.ts` — dedup keeping highest-confidence copy, frequency
  boosting, configurable per-engine source weights, stable score sort,
  `maxResults` cap.
- `src/core/observability.ts` — per-request `trace_id`/`correlation_id`,
  structured JSON logging (latency, cache hits, circuit trips).
- `src/core/cache.ts` — bounded LRU + TTL primitive with three levels:
  `SearchCache` (aggregate responses), `NormalizedCache` (per-engine results),
  `HealthCache` (short-TTL adapter health).
- Wired the full pipeline into `server.ts`/`manager.ts`: level-1 aggregate
  cache, level-2 per-engine cache, sanitize-everything, ranked output,
  per-engine error passthrough.
- 10 new pipeline tests (ranker dedup/weights, normalizer, cache levels,
  observability).

### Phase 5 — Deployment & verification

- `Dockerfile` — official Playwright Noble image (Chromium + OS deps),
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, unprivileged user, `/health`
  healthcheck.
- `ENV.example` — placeholders for `RIS_PROXY_KEY`, `SAUCENAO_API_KEY`,
  `BING_VISUAL_SEARCH_API_KEY`, browser and policy tuning vars.
- End-to-end integration test (`tests/integration.test.ts`) — boots the real
  Express app, drives the complete pipeline with mocked upstream HTTP,
  verifies auth/validation, dedup+ranking, partial completion, `SearchCache`
  reuse, and trace headers.
- Test-harness hardening:
  - The `test` script now injects deterministic credentials at the process
    level (bare `bun test` ignores scripts — always use `bun run test`).
  - `BaseApiAdapter` resolves `fetch` at call time so mocked upstreams work
    regardless of construction order; `tests/setup.ts` provides the shared
    dispatcher.

### CI & deployment config

- `.github/workflows/ci.yml` (repo root) — two jobs: **proxy** (frozen-lockfile
  install, `bun run build`, `bun run test` with browser download skipped) and
  **docker** (image build + live smoke test of `/health` and
  `/api/aggregate-search` incl. honest `tineye` failure).
- `render.yaml` / `fly.toml` — Docker build context fixed to `./proxy` so the
  Dockerfile's relative `COPY` paths resolve correctly; `/health` checks.

---

[Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [README](README.md)
