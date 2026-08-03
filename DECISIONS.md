# Decisions — institutional memory

> Architecture decisions that are **evident from the code**, with the file
> that demonstrates each one. No fictional decisions; if a rationale is
> inferred rather than documented, it says so.

---

## D1. Two-deployable split: frontend (Vite/React/Convex) + external proxy (Node/Express)

**Decision**: The image search does not run in the browser. A standalone
Express proxy (`proxy/`) owns every adapter, while the Vite/React/Convex app
owns UX and ephemeral hosting.

**Evidence**: `proxy/src/server.ts` (proxy HTTP surface), `src/convex/aggregate.ts`
(comment: "The browser never calls provider APIs directly. The proxy owns the
adapters"), `src/lib/engines.ts` (comment: "Every catalog item is dispatched
through the external proxy contract").

**Rationale (inferred)**: CORS and browser restrictions make direct provider
calls from the client impractical; server-side dispatch also keeps API keys
off the client.

## D2. External proxy contract over client-side dispatch / window.open

**Decision**: All 518 catalog ids route through one Convex action → one proxy
endpoint. The old per-engine `form-upload` / `url-open` dispatch is retained
as metadata on seed engines but is no longer the execution path; generated
entries use `mode: "proxy"`.

**Evidence**: `src/lib/engines.ts` — `ENGINES` maps every registry row to
`mode: "proxy"`; `src/convex/aggregate.ts` — `dispatchAggregateSearch`;
`proxy/src/server.ts` — `POST /api/aggregate-search`.

**Tradeoff**: one choke point to secure and monitor, at the cost of the proxy
being a hard dependency for any search.

## D3. Explicit provider registry over filesystem/dynamic discovery

**Decision**: adapters register explicitly in one place
(`registry.register(new X())`); the registry rejects duplicate ids and
`manager.ts` is the single registration point.

**Evidence**: `proxy/src/core/registry.ts` (`register` throws on duplicate),
`proxy/src/adapters/manager.ts` (registration chain), `proxy/README.md`
("no filesystem scanning or dynamic module discovery").

**Rationale**: bundlers/serverless/ESM make dynamic discovery fragile
(also stated in the proxy's ARCHITECTURE.md non-goals).

## D4. Honesty rule: no fabricated results, typed "unavailable" stubs

**Decision**: unimplemented engines are `UnavailableAdapter` stubs that throw
`AdapterNotImplementedError`; the scheduler treats that error as non-retryable
and does not trip the circuit breaker; the server returns it as a per-engine
error. No fake success.

**Evidence**: `proxy/src/adapters/stubs.ts`, `proxy/src/types.ts`
(`AdapterNotImplementedError`), `proxy/src/core/scheduler.ts` (exempts it in
`recordFailure`/`runWithPolicy`), `proxy/src/logging.ts` (`safeAdapterError`).

## D5. Layered configuration with clamping

**Decision**: config is `Defaults ← JSON config (RIS_CONFIG_PATH) ← environment
variables`, with hard clamps (concurrency ≤ 15, adapter timeout ≤ 15 s,
retries ≤ 2, cache entries ≤ 512, results ≤ 2000, port ≤ 65535).

**Evidence**: `proxy/src/core/config.ts` (`mergeSources`, `positiveInt`/clamps).

## D6. Priority scheduler with per-adapter circuit breakers

**Decision**: adapter execution is queued by priority
(`user_requested → recommended → optional`) with bounded concurrency,
per-task timeout, retries, and a per-adapter circuit breaker
(closed/open/half-open, failure threshold 3, reset 30 s, single recovery
probe). Cancellation and partial completion are first-class outcomes.

**Evidence**: `proxy/src/core/scheduler.ts` (`ExecutionScheduler`,
`CircuitState`, `SchedulerResult` statuses).

## D7. Three-level LRU+TTL caching

**Decision**: distinct caches for aggregate responses (`SearchCache`),
per-engine normalized results (`NormalizedCache`), and adapter health
(`HealthCache`, 30 s TTL), built on one bounded LRU+TTL primitive.

**Evidence**: `proxy/src/core/cache.ts` (`LruTtlCache`, three subclasses),
`proxy/src/adapters/manager.ts` (NormalizedCache short-circuit in
`executeAdapters`), `proxy/src/server.ts` (SearchCache lookup).

## D8. Normalize → sanitize → dedupe → rank at the boundary

**Decision**: every upstream result passes through canonical URL hashing
(fragment/tracking-param stripping), sanitization (http(s)-only, control-char
stripping, length caps, confidence clamp), dedupe by URL hash, and ranking
with configurable per-engine weights + frequency boosting.

**Evidence**: `proxy/src/core/normalizer.ts`, `proxy/src/core/ranker.ts`,
`proxy/src/adapters/base.ts` (`asString`/`asConfidence`/`safeUrl`).

## D9. DNS-resolved SSRF protection

**Decision**: incoming `imageUrl` must be http(s) with no embedded
credentials; localhost/`.local`/`.internal` and private/loopback/link-local/
metadata IP ranges are rejected, and **DNS is resolved** so every address
must be public.

**Evidence**: `proxy/src/security.ts` (`validatePublicImageUrl`,
`forbiddenIpv4`/`forbiddenIpv6`, `dns.lookup(…, { all: true })`).

## D10. Shared-secret bearer auth with timing-safe comparison

**Decision**: `RIS_PROXY_KEY` compared via `crypto.timingSafeEqual`; 32 KB
JSON body limit; `engineIds` validated (1–518 strings, ≤ 160 chars); request
ids + trace/correlation ids on every response.

**Evidence**: `proxy/src/server.ts` (`authorized`, `parseEngineIds`,
`express.json({ limit: "32kb" })`).

## D11. Secrets live server-side only — never in the browser bundle

**Decision**: `RIS_PROXY_URL`, `RIS_PROXY_KEY`, `EXA_API_KEY` are read from
`process.env` inside `"use node"` Convex actions. No `VITE_` secret vars.
`src/lib/proxyTypes.ts` explicitly states it "must never import or export
runtime credentials".

**Evidence**: `src/convex/aggregate.ts`, `src/convex/exa.ts`,
`src/lib/proxyTypes.ts`, `src/lib/engines.ts` header comment.

## D12. Ephemeral image hosting with a hard TTL

**Decision**: uploaded blobs are stored in Convex storage with a registry row
in `hostedImages`, swept by a cron after 24 h (`HOSTED_TTL_MS`). Search
history is never written to Convex — it lives in IndexedDB/localStorage.

**Evidence**: `src/convex/inquiries.ts` (`storeImage`, `purgeHostedImages`,
`HOSTED_TTL_MS`), `src/convex/crons.ts` (6-hourly purge), `src/lib/history.ts`,
`src/lib/inquiry-store.ts`.

## D13. Keep Vite + Convex (no framework migration)

**Decision**: the project remains Vite + React + Convex with the proxy as a
separate service; it does not migrate to Next.js or run Playwright inside the
app sandbox.

**Evidence**: `package.json` (Vite 7, React 19, Convex), `vite.config.ts`,
the entire `proxy/` being a separate Node deployable. This matches the
"no framework migrations" constraint documented in the repo's phase history.

## D14. Playwright base Docker image for browser automation

**Decision**: the proxy container is built on the official Playwright image
(Chromium + OS deps preinstalled), runs as non-root, skips browser
re-download, and exposes `/health` for orchestration checks.

**Evidence**: `proxy/Dockerfile`, `proxy/render.yaml`, `proxy/fly.toml`.

## D15. Test harness: env prefix in the npm script + shared fetch dispatcher

**Decision**: proxy tests get deterministic credentials via the `test` script
(`RIS_PROXY_KEY=test-secret … bun test tests`) because bun's runner shares
one process across files and the app config is built once; upstream HTTP is
mocked through a shared dispatcher (`tests/setup.ts`) and `BaseApiAdapter`
resolves `fetch` at call time so construction order doesn't freeze mocks.

**Evidence**: `proxy/package.json` (`test` script), `proxy/tests/setup.ts`,
`proxy/src/adapters/api/baseApiAdapter.ts` (`fetchImpl` getter).

## D16. Dynamic UI tinting via CSS variable override

**Decision**: the workbench live-tints the vintage accent variables
(`--brass`, `--seal`) from the active image's dominant palette, restoring a
cached baseline on unmount.

**Evidence**: `src/components/inquisitor/Preview.tsx` (`applyTintFromPalette`,
`baselineBrass`/`baselineSeal`).

## D17. Auth is present but not enforced on the workbench

**Decision** (observed, not necessarily final): `RequireAuth` and an Auth page
exist, but `/dashboard` is not wrapped in `RequireAuth` and `Dashboard.tsx`
is unrouted. This looks intentional (public workbench) or unfinished; flag in
ROADMAP as an open question.

**Evidence**: `src/components/RequireAuth.tsx` (defined), `src/main.tsx`
(routes without the wrapper), `src/pages/Dashboard.tsx` (unreferenced).
