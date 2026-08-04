# Roadmap — Image Inquisitor + RIS External Proxy

> Derived strictly from the current codebase: `TODO:`-style markers, stubbed
> or incomplete features, generated/unimplemented registry entries, unused
> code, and documented limitations. No speculative features are listed.
> Evidence file paths are given for every item.
>
> Source marker scan: no `TODO`/`FIXME`/`XXX`/`HACK` comments exist in
> `src/` or `proxy/src/`/`proxy/tests/` (grep-verified); the only match is the
> *functional* `AdapterNotImplementedError` type used by honest stubs. Planned
> work below therefore comes from stubs, generated entries, and gaps visible
> in the code.

---

## Completed — verified working

### Phase completion ledger

- [x] **Phase 9 — Input & Upload Flow Polish**: drag/drop wiring,
  dispatch-layer compression preserving local EXIF/GPS analysis, first-dispatch
  privacy warning UI, and cropper rotation bounds fix
  (`src/pages/Inquisitor.tsx`, `src/components/inquisitor/InputHub.tsx`,
  `src/lib/image-utils.ts`, `src/lib/inquiry-store.ts`,
  `src/components/inquisitor/Cropper.tsx`).

### Frontend (FreeBuff)

| Area | Evidence |
| --- | --- |
| Vintage workbench UI (Landing → Auth → Inquisitor) with sepia/aged-paper design system | `src/index.css`, `src/pages/Landing.tsx`, `src/pages/Inquisitor.tsx` |
| Five input modes (camera/gallery/web/files/clipboard) + paste & drag-drop anywhere | `src/components/inquisitor/InputHub.tsx`, `src/pages/Inquisitor.tsx` |
| Image analysis: EXIF+GPS, k-means palette, aHash, format conversion, cropper, OCR (Tesseract) | `src/lib/exif.ts`, `src/lib/palette.ts`, `src/lib/phash.ts`, `src/lib/format.ts`, `src/components/inquisitor/Cropper.tsx`, `Sidebar.tsx` |
| 518-entry engine catalogue: tier grouping, search, region/availability filters, "Engage every index", GPS auto-tick | `src/lib/engines.ts`, `src/lib/region.ts`, `src/components/inquisitor/Engines.tsx` |
| Search state machine + aggregate results + partial-error chips + failure notices | `src/lib/proxyTypes.ts`, `src/pages/Inquisitor.tsx`, `Engines.tsx` |
| Privacy-first history (IndexedDB + localStorage only) | `src/lib/history.ts`, `src/lib/inquiry-store.ts` |
| Dynamic UI tinting from the image's dominant palette | `src/components/inquisitor/Preview.tsx` (`applyTintFromPalette`) |
| PWA: service worker + manifest | `public/sw.js`, `public/manifest.webmanifest`, registration in `src/main.tsx` |

### Convex backend

| Area | Evidence |
| --- | --- |
| Auth (email OTP, anonymous, Freebuff custom-JWT) + users table | `src/convex/auth.ts`, `auth.config.ts`, `schema.ts` |
| Ephemeral image hosting with 24 h TTL and 6-hourly purge cron | `src/convex/inquiries.ts` (`HOSTED_TTL_MS`), `src/convex/crons.ts` |
| Secure proxy dispatch + adapter-status manifest actions | `src/convex/aggregate.ts` |
| Exa semantic search action (key-gated) | `src/convex/exa.ts` |
| Self-hosted multi-source Web Census (DDG/Wikipedia/OpenAlex/Archive/Open Library/GitHub) | `src/convex/census.ts` |

### RIS External Proxy (`proxy/`)

| Area | Evidence |
| --- | --- |
| Express server: `/api/aggregate-search`, `/api/adapters`, `/health`; timing-safe bearer auth; 32 KB body limit | `proxy/src/server.ts` |
| DNS-resolved SSRF protection | `proxy/src/security.ts` |
| Layered config (Defaults ← JSON ← env), explicit registry, routing engine, priority scheduler + circuit breakers | `proxy/src/core/config.ts`, `registry.ts`, `router.ts`, `scheduler.ts` |
| 3-level LRU+TTL caching; normalizer (URL hashing/sanitization); ranker (dedupe/weights/frequency boost); observability | `proxy/src/core/cache.ts`, `normalizer.ts`, `ranker.ts`, `observability.ts` |
| Live adapters: Bing Visual (API), SauceNAO (API), Google Lens (Playwright) | `proxy/src/adapters/bing.ts`, `api/sauceNaoAdapter.ts`, `browser/googleLensAdapter.ts` |
| 33 tests across 6 suites incl. full pipeline integration test | `proxy/tests/*.test.ts` |
| Dockerfile + Render/Fly configs + CI workflow | `proxy/Dockerfile`, `render.yaml`, `fly.toml`, `.github/workflows/ci.yml` |

---

## In progress — WIP present in code

- **518-service catalog vs. 4 live adapters.** The registry generates exactly
  518 ids (`src/lib/engines.ts`: 55 verified seeds + locale variants +
  `seed-proxy-N` lanes, `supported: false` for generated), but only `bing`,
  `saucenao`, `google-lens`, and the `tineye` stub are registered
  (`proxy/src/adapters/manager.ts`). All other ids resolve through
  `unavailableAdapter()` → honest `AdapterNotImplementedError`. The contract
  is ready; adapter coverage is the open work.
- **TinEye adapter.** Registered as an `UnavailableAdapter` stub with
  `integrationType: "unavailable"` and a specific reason string
  (`proxy/src/adapters/stubs.ts`). Placeholders `TINEYE_API_KEY` /
  `TINEYE_API_URL` exist in `proxy/ENV.example`; the adapter stays a stub
  until a permitted account-specific integration is configured.
- **Live adapter status sync.** `enginesManifest` (`src/convex/aggregate.ts`)
  fetches `GET /api/adapters` and Engines.tsx renders Live/Planned chips; if
  the proxy is unreachable or unset, the UI silently falls back to "planned"
  (non-fatal, logged). Manifest-derived "healthy" state is fetched but the UI
  currently renders only the active/planned split (`Engines.tsx`).

---

## Planned — explicit future-work markers

- **More adapters** for the catalog: any new integration should follow the
  runbook in `proxy/CONTRIBUTING.md` (choose integration type honestly →
  implement lifecycle → register in `manager.ts` → tests). No specific
  adapter is named in code as "next".
- **Frontend test suite**: none exists today; package.json has lint/build
  only. Type-gate is `bun tsc -b --noEmit`.
- **Frontend typecheck in CI**: currently impossible without deployment
  credentials because `src/convex/_generated/` is gitignored and Convex 1.30
  has no offline codegen (documented in `.github/workflows/ci.yml` comments).
- **RequireAuth wiring**: `src/components/RequireAuth.tsx` exists and is
  correctly built (redirects to `/auth?returnTo=…`) but **no route wraps it**
  — `/dashboard` is publicly reachable today. Wiring it is the natural next
  step if the workbench should require sign-in.
- **`Dashboard.tsx`**: `src/pages/Dashboard.tsx` is a standalone starter page
  not referenced by any route in `src/main.tsx`; it's either dead code to
  remove or a future home page.

---

## Unknown — needs product clarification

- Whether the workbench (`/dashboard`) should be **auth-gated** (RequireAuth
  is written but unused) — affects landing CTAs, `returnTo` flow, and the
  `Auth` page's `redirectAfterAuth="/dashboard"` default.
- Which engines to prioritize for **next adapters** on the proxy — the
  518-entry catalog has no priority ordering in code.
- Whether **Exa** (`EXA_API_KEY`) is intended as a paid add-on vs. the
  free self-hosted census as the default text-research lane (`src/convex/exa.ts`
  vs. `census.ts`); the Sidebar exposes both ("Semantic Registry").
- **Deployment target for the proxy** — Render/Fly/Docker configs all exist
  (`proxy/render.yaml`, `fly.toml`, `Dockerfile`); no live URL is referenced
  in the frontend code, so `RIS_PROXY_URL` is deployment-specific
  `[Unverified: no production endpoint observed in repo]`.
- Whether `supported: false` generated engine rows should ever appear as
  "Live" — today they can't, because the proxy only knows registered
  adapters.

---

## Process notes

- Git history is platform-managed (VCS blocked in sandbox) — ROADMAP items
  are evidence-based from files, not commit archaeology.
- Re-scan for `TODO/FIXME` before trusting this file as complete; new code
  should prefer explicit issue tracking over in-source markers, or add
  markers with an owner.
