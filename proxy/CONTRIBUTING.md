# RIS External Proxy — Contributing

> Read [ARCHITECTURE.md](ARCHITECTURE.md) first. This guide is the
> step-by-step for adding engines and following the project's conventions.

## Development setup

```bash
cd proxy
bun install
bun run build          # type-check + compile to dist/ (tsc -p tsconfig.json)
bun run test           # full suite — always use `bun run test`, NOT bare `bun test`
RIS_PROXY_KEY=local-secret bun run dev   # tsx watch
```

> **Why `bun run test`?** The test script injects deterministic credentials
> (`RIS_PROXY_KEY`, `SAUCENAO_API_KEY`, `BING_VISUAL_SEARCH_API_KEY`) at the
> **process level**. bun runs all test files in one shared process and the app
> singleton is built once by whichever file imports it first — so bare
> `bun test` would give the suite inconsistent credentials. Always go through
> the npm script. See [Testing](#testing).

## How to add a new adapter

### Step 1 — Decide the integration type (be honest)

| You have | Use | Example |
| --- | --- | --- |
| A documented, permitted HTTP API | `BaseApiAdapter` | SauceNAO, Bing Visual |
| A real need for headless browser automation (and the target tolerates it) | `BaseBrowserAdapter` | Google Lens |
| Neither (or it requires auth you don't have) | An `UnavailableAdapter` stub | TinEye |

Never fabricate results. If you cannot implement an engine, register an
honest unavailable stub — the pipeline converts it into a structured error
that the frontend renders as "planned".

### Step 2 — Implement the adapter

**Official API** — extend `BaseApiAdapter` (`src/adapters/api/baseApiAdapter.ts`):

```ts
import { BaseApiAdapter } from "./baseApiAdapter.js";
import type { RawSearchResult, NormalizedResult } from "../base.js";

export class MyEngineAdapter extends BaseApiAdapter {
  readonly id = "my-engine";
  readonly name = "My Engine";
  readonly capabilities = {
    supportsImageUpload: false,
    supportsUrlInput: true,
    requiresAuth: true,
    integrationType: "official_api" as const,
  };

  protected buildUrl(imageUrl: string): string {
    // Documented request construction — see SauceNaoApiAdapter for the pattern.
    return `https://api.example.com/search?url=${encodeURIComponent(imageUrl)}`;
  }

  protected async parseBody(body: unknown, imageUrl: string): Promise<RawSearchResult[]> {
    // Map the upstream JSON to RawSearchResult[].
    return [];
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    // Use the base.ts helpers (result(), safeUrl, asConfidence…) — never raw values.
    return [];
  }
}
```

The base already gives you: injected `fetchImpl` (tests never touch the
network), per-request `AbortController` timeout, transient-status retry
classification (408/425/429/5xx) with backoff, and lifecycle/health defaults.
Read your credential through the layered config, e.g.
`proxyConfig.secrets.<yourKey>` — never `process.env` directly in the adapter
(keep the config seam in `src/core/config.ts`).

**Browser automation** — extend `BaseBrowserAdapter`
(`src/adapters/browser/baseBrowserAdapter.ts`). It manages the shared
Chromium context, detection-mitigation config, and an injectable
`browserFactory`. Study `googleLensAdapter.ts`: it shows scraping a results
DOM, unwrapping redirectors, filtering chrome links, and throwing
`BrowserBlockedError` on CAPTCHA/unusual-traffic pages so the circuit breaker
backs off.

**Unavailable** — add a `new UnavailableAdapter(id, name, capabilities, reason)`
instance (see `tinEyeStub` in `src/adapters/stubs.ts`). The reason string
becomes the surfaced error.

### Step 3 — Register it (one place only)

`src/adapters/manager.ts`:

```ts
registry
  .register(new BingVisualAdapter())
  .register(new SauceNaoApiAdapter())
  .register(tinEyeStub)
  .register(new GoogleLensAdapter())
  .register(new MyEngineAdapter());   // ← add yours
```

Rules enforced by `AdapterRegistry.register()`:
- `id` must be non-empty and **unique** — a duplicate id throws at boot.
- The id must match the catalog id used by the FreeBuff frontend registry
  (`src/lib/engines.ts`) so the manifest sync lights it up as **live**.
- Registration is explicit — never add filesystem scanning or auto-discovery.

### Step 4 — Config & env placeholders

- Add any new secrets/options to `ProxyConfig`/`ConfigSource` in
  `src/core/config.ts` (+ defaults + env parsing in `envSource`).
- Add the placeholder to `ENV.example` (the tracked template — never commit
  real secrets).
- If the adapter reads a secret, wire it in `src/config.ts`'s facade too.

### Step 5 — Tests (required)

Add `src/tests/<adapter>.test.ts` (files live in `tests/`, e.g.
`tests/saucenao.test.ts`, `tests/googleLens.test.ts`) covering:

1. **Request construction** — the exact URL/headers the adapter will send
   (asserted against the mocked `fetch`).
2. **Normalization** — upstream payload → `NormalizedResult[]`, including
   metadata fields like `dimensions`; use `base.ts` sanitizer behavior.
3. **Graceful failure** — transient status retry inside the base; blocked
   page → `BrowserBlockedError` → circuit breaker trips open; empty page →
   honest `[]`.
4. **Registration** — the adapter is explicitly registered under its id
   (assert via `listAdapters()` / `providerRegistry()`).

**Tests must never touch the network.** Inject `fetch` (`mockUpstream` from
`tests/setup.ts` for the shared dispatcher) or a fake browser factory.
`BaseApiAdapter` resolves `fetch` at call time, so mock installation order
doesn't matter.

### Step 6 — Verify

```bash
cd proxy
bun run build && bun run test    # 0 type errors, all tests green
```

Then run the full-suite gate: `bun tsc -b --noEmit` in the repo root is not
required for proxy-only changes, but the proxy build itself is.

## Testing

- **`tests/server.test.ts`** — HTTP contract: auth (401), SSRF rejection
  (400), body limits (413), `/health`, `/api/adapters`, aggregate responses.
- **`tests/core.test.ts`** — scheduler priority/retry/timeout/cancel,
  circuit-breaker states, router capability negotiation.
- **`tests/pipeline.test.ts`** — ranker dedup/weights/frequency boost,
  normalizer sanitization, cache LRU/TTL, observability ids.
- **`tests/integration.test.ts`** — boots the real Express app and drives the
  full pipeline (routing → scheduler → adapters → normalizer → ranker →
  cache) with mocked upstream HTTP, verifying trace headers and partial
  completion.
- **`tests/setup.ts`** — the shared `mockUpstream` fetch dispatcher.

Keep the suite green: currently **33 tests**. Run `bun run test` (not bare
`bun test`).

## Coding conventions

- **Runtime** — Node ≥ 20, TypeScript strict, ESM (`"type": "module"`).
  Relative imports use `.js` suffixes (e.g. `./base.js`) — required by the
  ESM/NodeNext-style resolution in this repo.
- **No runtime-config mutation** — policy values (timeouts, retries, cache
  sizes, thresholds) come from the layered config, never hardcoded in call
  sites. Extend `src/core/config.ts` when you need a knob.
- **Explicit registration** — no filesystem scanning, no dynamic discovery,
  no duplicate adapter ids.
- **Sanitize at the boundary** — use `base.ts` helpers (`safeUrl`,
  `asString`, `asConfidence`, `result`) and the normalizer; never pass raw
  upstream strings/URLs through to responses.
- **Honesty** — no fake results, no pretend support. Unavailable engines get
  honest stubs.
- **Credential isolation** — never log API keys, tokens, URLs, or upstream
  payloads; adapters read secrets only from config.
- **Observability** — use `createLogger` with `trace_id`/`correlation_id`;
  log structured JSON, one object per line.
- **Docs** — if you change behavior, update `ARCHITECTURE.md` in the same
  change, and note it in `CHANGELOG.md` under *Unreleased*.

## Definition of done

- [ ] Adapter implements the full lifecycle and `IImageSearchAdapter`.
- [ ] Registered explicitly in `manager.ts` (unique id matching the frontend catalog).
- [ ] Config/env wiring added to `core/config.ts` + `ENV.example`.
- [ ] Tests added (request construction, normalization, graceful failure, registration) and never hit the network.
- [ ] `bun run build` passes; `bun run test` passes with zero failures.
- [ ] `ARCHITECTURE.md` / `CHANGELOG.md` updated if behavior changed.
