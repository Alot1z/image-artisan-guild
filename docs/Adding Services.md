# Adding Services

Add services in the external proxy, not as browser-side forms or guessed URLs.

1. Add or verify the provider adapter in the proxy deployment.
2. Add a stable seed record to `VERIFIED_ENGINES` only when its metadata is known.
3. Keep the proxy request/response contract unchanged.
4. Return a stable `id`, `sourceUrl`, and optional image metadata.
5. Mark an entry supported in the proxy configuration when its adapter is ready.
6. Run `bun convex dev --once` and `bun tsc -b --noEmit`.

The client registry is capped at 518 entries. Generated IDs are routing records and must not be described as direct provider integrations until the proxy confirms support.
