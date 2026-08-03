# RIS External Proxy

An isolated Node.js/TypeScript service for the FreeBuff image-intelligence workbench. It accepts a short-lived public image URL plus selected engine IDs, executes only configured adapters, and returns one normalized response without persisting images or search results.

## Structure

```text
proxy/
├── src/
│   ├── adapters/
│   │   ├── base.ts       # safe upstream/result helpers
│   │   ├── bing.ts       # Bing Visual Search official API adapter
│   │   ├── manager.ts    # dynamic registry, p-limit, retries, ranking
│   │   ├── saucenao.ts   # SauceNAO official URL API adapter
│   │   └── stubs.ts      # honest unavailable/experimental adapters
│   ├── cache.ts          # TTL-aware in-memory LRU
│   ├── config.ts
│   ├── logging.ts        # structured, credential-safe JSON logs
│   ├── security.ts       # URL, DNS, and private-IP validation
│   ├── server.ts         # Express routes and authentication
│   ├── types.ts
│   └── index.ts
├── tests/server.test.ts
├── Dockerfile
├── render.yaml
└── fly.toml
```

## Run locally

```bash
cd proxy
cp ENV.example .env
# Set RIS_PROXY_KEY in the environment; never commit .env.
bun install
bun run build
bun test tests
RIS_PROXY_KEY=local-secret bun run dev
```

The managed Freebuff app should point `RIS_PROXY_URL` at the deployed `/api/aggregate-search` endpoint and use the same `RIS_PROXY_KEY` value.

## Endpoint

```bash
curl -X POST http://localhost:3000/api/aggregate-search \
  -H 'Authorization: Bearer local-secret' \
  -H 'Content-Type: application/json' \
  -d '{"imageUrl":"https://example.com/image.jpg","engineIds":["saucenao","bing","google-lens"]}'
```

The request accepts `engineIds` and also `engine_ids` for compatibility. The response shape is:

```json
{
  "status": "success",
  "request_id": "uuid-string",
  "total_results": 0,
  "results": [],
  "errors": [
    { "engine_id": "google-lens", "error": "Google Lens adapter is experimental and not enabled in this proxy" }
  ]
}
```

A request is considered successful at the HTTP layer when the proxy validates and runs it; individual adapter failures are isolated in `errors`.

## Adapter status

| Adapter | Type | Status |
| --- | --- | --- |
| `saucenao` | Official API | Implemented when `SAUCENAO_API_KEY` is present |
| `bing` | Official API | Implemented when `BING_VISUAL_SEARCH_API_KEY` is present |
| `tineye` | Unavailable | Account/plan-specific API contract must be configured; no endpoint is guessed |
| `google-lens` | Experimental | Explicitly disabled; no automated provider scraping is performed |
| Other 514+ IDs | Unavailable | Dynamic stubs return a structured error and never fake results |

## Security and resilience

- Only HTTP(S) image URLs are accepted.
- Hostnames are resolved with DNS and private, loopback, link-local, metadata, test, multicast, and reserved ranges are rejected.
- Bearer authentication uses a timing-safe comparison.
- JSON bodies are capped at 32 KB and selections at 518 IDs.
- Adapter calls are limited to 12 concurrent executions by default, with a maximum configurable concurrency of 15.
- Each attempt has a 15-second timeout and up to two retries; one failure never aborts the full aggregate.
- Results are sanitized to bounded HTTP(S) URLs and text, deduplicated by canonical image URL, and ranked by confidence.
- Logs are structured JSON and exclude URLs, credentials, raw upstream payloads, and response bodies.
- The in-memory LRU is bounded and TTL-based; restarting the container clears it.

## Docker

The Dockerfile uses the official Playwright Noble image so future permitted Playwright adapters can be added without changing the base image. It builds and runs as a non-root user. Playwright automation is intentionally not enabled for unsupported providers in Phase 1. `ENV.example` is the checked-in template; copy it to `.env` for local work, and keep `.env` out of version control.

```bash
docker build -f proxy/Dockerfile -t ris-external-proxy .
docker run --rm -p 3000:3000 \
  -e RIS_PROXY_KEY=local-secret \
  --init ris-external-proxy
```
