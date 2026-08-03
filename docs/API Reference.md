# API Reference

## `api.aggregate.aggregateSearch`

Public Convex action used by the workbench.

```ts
await aggregateSearch({
  imageUrl: string,
  engineIds: string[],
});
```

The action validates and deduplicates IDs, caps the selection at 518, calls the configured proxy server-side, and returns no persisted data.

### Success

```ts
{
  ok: true,
  searchedAt: number,
  serviceCount: number,
  results: Array<{
    id: string;
    title: string;
    sourceUrl: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    score?: number;
    matchType?: string;
    services?: string[];
  }>
}
```

### Failure

`ok` is `false` with one of:

- `missing-config` — `RIS_PROXY_URL` or `RIS_PROXY_KEY` is absent
- `proxy-error` — proxy returned a non-success response or could not be reached
- `rate-limited` — proxy returned HTTP 429
- `invalid-response` — proxy returned JSON without `results` or `matches`

The proxy endpoint receives `Authorization: Bearer <RIS_PROXY_KEY>` and JSON `{ imageUrl, engineIds }`.
