# Contributing — Image Inquisitor + RIS External Proxy

Guidelines for contributing to the FreeBuff frontend (repo root `src/`) and
the RIS External Proxy (`proxy/`). Everything here reflects the current
codebase; if a step doesn't match reality, update this file.

---

## 1. Development setup

### Prerequisites

- **Bun** (frontend + proxy use `bun`; CI pins Bun 1.3.14 — see
  `.github/workflows/ci.yml`)
- Node.js ≥ 20 (proxy `engines` field in `proxy/package.json`)
- A Freebuff/Convex project with auth enabled (frontend), and optional Docker
  for the proxy image

### Frontend (repo root)

```bash
bun install
bun convex dev --once   # codegen for src/convex/_generated (required before tsc)
bun tsc -b --noEmit     # type gate — must pass
bun run dev             # Vite dev server (managed by the platform)
```

Required secrets (set in the project **Keys/API keys** tab, never in files):

| Variable | Purpose |
| --- | --- |
| `VITE_CONVEX_URL` | Convex deployment URL (bootstrap, `src/main.tsx`) |
| `RIS_PROXY_URL` | POST endpoint implementing the aggregate-search contract |
| `RIS_PROXY_KEY` | Bearer credential the Convex action sends to the proxy |
| `EXA_API_KEY` | Optional — enables the Exa semantic search action (`src/convex/exa.ts`) |

> No `VITE_`-prefixed *secret* variables. The browser must never hold
> `RIS_PROXY_KEY`/`EXA_API_KEY`.

### Proxy (`proxy/`)

```bash
cd proxy
bun install
bun run build           # tsc → dist/
bun run test            # full suite (33 tests) — env prefix handled by the script
RIS_PROXY_KEY=local-secret bun run dev
```

Copy `proxy/ENV.example` for the full variable reference. Adapter keys
(`SAUCENAO_API_KEY`, `BING_VISUAL_SEARCH_API_KEY`) only unlock the adapters
that need them; every engine can still be *requested*, and unconfigured ones
return honest per-engine errors.

---

## 2. Project structure

See `ARCHITECTURE.md` §2 for the full map. Key rules of thumb:

- Frontend UI lives in `src/components/inquisitor/` (workbench) and
  `src/components/ui/` (shadcn/ui primitives — prefer these over new
  hand-rolled components).
- All shared wire types between the Convex actions and the UI live in
  `src/lib/proxyTypes.ts` — **do not redefine them locally**.
- The engine catalog is `src/lib/engines.ts` (registry + 518-entry
  `EngineRegistry`). The proxy owns adapter execution; this file only models
  the catalog.
- Proxy adapters live in `proxy/src/adapters/` grouped by integration type
  (`api/`, `browser/`), with the lifecycle defined in `base.ts`.

---

## 3. Code style & conventions

- **TypeScript strict** — both apps compile with `tsc`; no `any` leaks in new
  code. Proxy: **ESM with `.js` import suffixes** (e.g.
  `import { x } from "./core/cache.js"`) — required for Node ESM + `tsx`.
- **Frontend**: React 19 function components + hooks only; never shadow hook
  names; keep hooks out of loops/conditionals. Tailwind 4 classes with the
  vintage token set from `src/index.css` (`--brass`, `--seal`, `--ink`,
  `--paper-tint`…). Use shadcn/ui primitives from `src/components/ui/` and
  the `cn()` helper (`src/lib/utils.ts`).
- **Sanitize at the boundary** — every piece of external data that crosses
  into the app must be scrubbed: the proxy sanitizes via
  `proxy/src/core/normalizer.ts`; Convex re-sanitizes errors/results
  (`src/convex/aggregate.ts`).
- **Credential isolation** — never log image URLs, auth headers, or API keys
  (`proxy/src/logging.ts`, `proxy/src/core/observability.ts`). Never put a
  secret in a `VITE_` variable or commit `.env*`.
- **Honesty rule** — an adapter that can't be implemented must throw
  `AdapterNotImplementedError` (or be an `UnavailableAdapter` stub). Never
  fabricate search results.
- Prettier + ESLint are configured at the frontend root (`bun run lint`,
  `bun run format`); proxy has no lint script — keep formatting consistent
  with the surrounding files.

---

## 4. Adding a frontend feature

1. **Model the data** — if it crosses the wire, add the type to
   `src/lib/proxyTypes.ts` (shared with Convex). If it's per-asset state,
   extend `InquiryAsset` and the `useInquiryStore` actions in
   `src/lib/inquiry-store.ts`.
2. **Backend first** — implement the Convex query/mutation/action in
   `src/convex/`, then run `bun convex dev --once` to regenerate types.
3. **Component** — build against `src/components/ui/*` + the vintage tokens;
   wire state through the store or props from `src/pages/Inquisitor.tsx`.
4. **Respect the search phase machine** — anything that touches dispatch
   must honor `SearchPhase` (`idle|uploading|searching|processing|complete|
   failed`) and render partial `aggregateErrors` + `failureNotice` states.
5. **Verify** — `bun convex dev --once && bun tsc -b --noEmit`.

---

## 5. Adding a proxy adapter (runbook)

Mirror an existing adapter (`proxy/src/adapters/bing.ts`,
`api/sauceNaoAdapter.ts`, or `browser/googleLensAdapter.ts`).

1. **Choose the integration type honestly** — `official_api` (documented
   API), `partner_api`, `playwright` (headless browser), `experimental`, or
   `unavailable` (stub). If there is no permitted/stable path, ship an
   `UnavailableAdapter` stub instead of faking results.
2. **Implement the lifecycle** — `warmup()` → `initialize()` →
   `execute(imageUrl): Promise<RawSearchResult[]>` →
   `normalize(raw): NormalizedResult[]` → `healthCheck(): Promise<boolean>`
   (+ `cleanup()`), plus a `capabilities` object. Extend
   `BaseApiAdapter` (API JSON with retries + late-bound fetch) or
   `BaseBrowserAdapter` (Playwright) when the integration fits.
3. **Normalize defensively** — use `asString`/`asConfidence`/`safeUrl`/`result`
   from `base.ts`; never trust upstream shapes; emit
   `{ source_engine, url, thumbnail?, confidence, metadata }`.
4. **Register it in one place** — add to the chain in
   `proxy/src/adapters/manager.ts` (`registry.register(new YourAdapter())`).
   Duplicate ids throw (`src/core/registry.ts`).
5. **Config & env** — add placeholders to `proxy/ENV.example` and, if the
   adapter needs tuning knobs, to `DEFAULT_CONFIG`/`envSource` in
   `proxy/src/core/config.ts`.
6. **Tests (required)** — add a suite in `proxy/tests/` mirroring
   `saucenao.test.ts` (URL construction + normalization + retries + explicit
   registration) and, for browser adapters, `googleLens.test.ts` (fake
   browser/page fixtures from `tests/setup.ts`).
7. **Verify** — `cd proxy && bun run build && bun run test`.

---

## 6. Testing

- **Frontend**: `bun convex dev --once` then `bun tsc -b --noEmit`. There is
  currently no frontend test suite.
- **Proxy**: `cd proxy && bun run test`. ⚠️ Use **`bun run test`**, not bare
  `bun test`: the script injects deterministic test env
  (`RIS_PROXY_KEY=test-secret …`) because bun's runner shares one process
  across files and the app config is built once at first import.
- The proxy tests mock upstream HTTP via the shared dispatcher in
  `tests/setup.ts`; the `integration.test.ts` boots the real Express app end
  to end.

---

## 7. Pull request checklist

- [ ] `bun convex dev --once` (frontend changes touching `src/convex/`)
- [ ] `bun tsc -b --noEmit` passes (frontend)
- [ ] `cd proxy && bun run build && bun run test` passes (proxy changes)
- [ ] New adapters registered in `manager.ts` + covered by tests
- [ ] Wire types added to `src/lib/proxyTypes.ts` where the contract changed
- [ ] `ENV.example` updated for new proxy env vars; Keys-tab vars documented
- [ ] No secrets in code, logs, or `VITE_` vars; no `.env*` committed
- [ ] No fabricated results — stubs throw `AdapterNotImplementedError`
- [ ] README/architecture docs updated if behavior or structure changed

---

## 8. Common mistakes

- Running bare `bun test` in the proxy (env missing → auth tests 401).
- Editing `src/convex/_generated/*` by hand — regenerate with
  `bun convex dev --once` instead.
- Importing `./foo` without the `.js` suffix in proxy ESM code.
- Duplicating `AggregateResult`/`SearchResult` types instead of importing
  from `src/lib/proxyTypes.ts`.
- Committing `.env` files or hardcoding `RIS_PROXY_KEY`.
- Treating the 518-entry catalog as "implemented" — `supported: false`
  entries and unregistered ids return unavailable errors by design.
- Changing `proxy/Dockerfile` build context without updating
  `render.yaml`/`fly.toml` (both use context `./proxy`).
