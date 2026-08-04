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

---

## 2026-08-03 | Phase 7: Search UX Refinement

**Decision**: Frontend-only refinement of the proxy result presentation in
`src/components/inquisitor/Engines.tsx` and `src/pages/Inquisitor.tsx`:
enriched result cards (rank, source-engine badges with real provider names
via `engineById`, confidence meter, domain/dimensions metadata), a
phase-stepper loading indicator bound to the existing `SearchPhase` machine,
and a per-engine retry flow (`onRetryEngines` → `retryFailedEngines`) that
re-dispatches only failed engine ids and merges new matches into the existing
ledger by source-URL dedupe.

**Reason**: Successful/partial-failure/loading/completion states were hard to
read; failed engines had no recovery path. The proxy response contract, the
Convex action, and the `SearchPhase` machine are unchanged.

**Alternatives considered**: (a) Re-run the full `ensureHostThenDispatch` on
retry — rejected because it clears the ledger and would duplicate successful
results; (b) a generic reusable result-framework component — rejected per the
no-premature-abstraction rule (helpers stay local to Engines.tsx);
(c) moving confidence/ranking computation to the proxy — rejected (backend
out of scope).

**Impact**: Two files modified (`Engines.tsx`, `Inquisitor.tsx`); no new
dependencies, no CSS/token changes, no contract or schema changes. Verified:
`bun tsc -b --noEmit` exit 0; proxy suite 33 pass / 0 fail. No measured
performance regression (all work is render-time; retry adds one bounded
`aggregateSearch` call per failed batch). Structural change: new optional
`onRetryEngines` prop on `Engines`, module-local `mergeAggregateResults`
helper, and three local presentational components (`ScoreMeter`,
`EngineSourceBadge`, `PhaseSteps`).

---

## 2026-08-03 | Phase 8: Tier 1 Provider Expansion

**Decision**: Backend-only expansion of live Tier 1 coverage in the RIS
External Proxy: (a) replaced the `tineye` `UnavailableAdapter` stub with a
real official-API adapter (`proxy/src/adapters/api/tinEyeAdapter.ts`)
following the existing `BaseApiAdapter` lifecycle and the documented TinEye
REST contract (Basic auth key:secret, `GET {endpoint}?url=&limit=`);
(b) fixed the Bing Visual adapter's wire contract to the documented v7.0
format (form-urlencoded `imageInfo` JSON string body, `tags->actions->value`
array-aware normalization); (c) wired `TINEYE_API_KEY`/`TINEYE_API_SECRET`/
`TINEYE_API_URL` into the layered config; (d) added a 7-test suite.

**Reason**: The catalog already listed `tineye` as a target and `bing` as a
live adapter, but the Bing request body was incompatible with the documented
API and TinEye had no execution path. Phase 8's goal was real provider
execution capability without fake availability.

**Alternatives considered**: (a) Keep the TinEye stub and only fix Bing —
rejected: leaves a documented Tier 1 target with zero execution path;
(b) implement TinEye via Playwright browser automation — rejected: forbidden
by the phase non-goals and the honesty rule (official API exists);
(c) add catalog ids to pad coverage — rejected: violates the catalog
consistency rule (no adapter → stay unavailable).

**Impact**: Files changed are proxy-only plus the changelog/DECISIONS docs —
no frontend, Convex, registry design, scheduler/router behavior, normalized
response contract, or security model changes. New config keys only in
`proxy/ENV.example` + `proxy/src/core/config.ts`. Verified: `bun run build`
exit 0; `bun run test` 40 pass / 0 fail (33 prior + 7 new). No measured
performance regression (single bounded GET per search). Structural change:
new `tinEyeAdapter.ts`, registration swap in `manager.ts`, `tinEyeStub`
removed from `stubs.ts`, config `ProxySecrets` extended with
`tineyeApiKey`/`tineyeApiSecret` and `ProxyConfig` with `tineyeApiUrl`.

## 2026-08-04 | Phase 9: Input & Upload Flow Polish

**Decision**: Frontend-only polish keeps the original local `InquiryAsset.blob`
as the source for preview, EXIF/GPS extraction, palette extraction,
perceptual hash generation, OCR, and IndexedDB history, while applying
`compressForUpload()` only inside the hosting/dispatch path before Convex
storage receives the outbound payload. The drag overlay now forwards dropped
files into the existing `store.add("drag", file)` ingestion path without
falling through to the window drop handler. First hosting/dispatch is gated by
a user-facing privacy notice that only states verified behavior: upload
occurs, metadata may include location, and the user chooses whether to
continue. The cropper preview scales the rotated bounding box to fit the
canvas and avoids an extra canvas restore call.

**Reason**: The phase objective required dispatch payload compression without
stripping local EXIF/GPS data, live drag-and-drop wiring, a verified privacy
warning, and a rotation clipping fix without changing proxy contracts,
Convex schema, crop interaction, aspect presets, touch behavior, or output
format.

**Alternatives considered**: (a) Compress during ingestion — rejected because
canvas re-encoding strips metadata before GPS-driven regional engine
selection can run; (b) change the proxy or Convex storage contract — rejected
as out of scope; (c) redesign the cropper around transformed DOM elements —
rejected because the existing pointer/canvas cropper only needed corrected
rotated bounds.

**Impact**: No proxy, Convex schema, API contract, dependency, or search state
machine changes. No measured performance regression; large images may spend
bounded client CPU time in the existing canvas downscale path before upload.
Structural changes: `compressForUpload()` wrapper in `src/lib/image-utils.ts`,
`hostBlob()` dispatch-stage compression in `src/pages/Inquisitor.tsx`,
live `DropZone.onFiles` forwarding in `src/components/inquisitor/InputHub.tsx`,
first-dispatch privacy gate in `src/pages/Inquisitor.tsx`, cropper rotation
fit logic in `src/components/inquisitor/Cropper.tsx`, and a landing-page
provenance notice in `src/pages/Landing.tsx`. Verified:
`bun tsc -b --noEmit` exit 0.
