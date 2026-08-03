# Architecture

The Inquisitor remains a Vite + React + Convex application. Provider-specific reverse-image integrations are deliberately outside the client and Convex runtime.

```mermaid
sequenceDiagram
  participant U as Workbench
  participant C as Convex
  participant S as Short-lived storage
  participant P as External proxy

  U->>C: storeImage(base64, mimeType)
  C->>S: store blob
  C-->>U: hosted URL
  U->>C: aggregateSearch(hosted URL, engine IDs)
  C->>P: POST with Bearer key
  P-->>C: ranked results / matches
  C-->>U: normalized response
  Note over C,S: cleanup cron removes blobs older than 24h
```

`src/lib/engines.ts` exposes `EngineRegistry`, exactly 518 routing records. Verified seeds retain descriptive metadata; generated variants are honest proxy lanes with `supported: false` until the proxy enables them.

The proxy request is authenticated server-side with `RIS_PROXY_KEY`. The browser never receives that key and never calls provider APIs directly.
