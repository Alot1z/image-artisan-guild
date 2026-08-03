# API Reference

The Inquisitor stays thin on server surface area. There is one Convex
action and otherwise everything is in-browser.

## Convex action: `storeImage`

```ts
// src/convex/inquiries.ts
"use node";
export const storeImage = action({
  args: {
    base64: v.string(),         // base64-encoded image bytes (no data:* prefix)
    mimeType: v.string(),       // e.g. "image/jpeg"
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const buf = Buffer.from(args.base64, "base64");
    const blob = new Blob([buf], { type: args.mimeType });
    const storageId = await ctx.storage.store(blob);
    return { url: await ctx.storage.getUrl(storageId), storageId };
  },
});
```

The Inquisitor calls this via `useUploader()` in
`src/components/inquisitor/Engines.tsx`:

```ts
const uploader = useUploader();
const url = await uploader(dataUrl, mimeType, fileName);
```

The resulting URL is the `hostedImageUrl` plumbed into every
`Engine.urlBuilder(...)` for URL-mode engines.

## In-browser helpers — `src/lib/`

### `engines.ts`

```ts
import {
  ENGINES,            // readonly Engine[] of 40 services in 4 tiers
  engineById,         // (id: string) => Engine | undefined
  enginesByTier,      // (tier: 1|2|3|4) => Engine[]
  enginesByRegion,    // (region: Region) => Engine[]
  TIER_TITLES,        // { 1, 2, 3, 4 } → display strings
  dispatchByForm,     // (engine, blob) => hidden <form> ready to submit
  openByUrl,          // (engine, hostedUrl) => window.open(...)
} from "@/lib/engines";
```

### `region.ts`

```ts
import {
  regionFromGeo,       // (point: GeoPoint) => Region
  suggestedEngineIds,   // (point: GeoPoint | null) => string[]
  commonNameForGeo,     // (point) => string — coarse locale label
} from "@/lib/region";
```

### `exif.ts`

```ts
import { readExif, readGeoPoint, summarizeExif, type ExifData } from "@/lib/exif";
```

`readGeoPoint` is the helper the Inquisitor uses to derive the regional
hint banner.

### `palette.ts`

```ts
import { extractPalette, type Swatch } from "@/lib/palette";
// Swatch: { hex: string, share: number }
```

### `phash.ts`

```ts
import { perceptualHash, similarityPercent } from "@/lib/phash";
```

`perceptualHash` returns a 16-char hex string (64-bit aHash).
`similarityPercent(a, b)` returns 0..1.

### `image-utils.ts`

```ts
import {
  blobToMeta, blobToDataUrl, dataUrlToBlob,
  downscale, describe, humanSize,
  readClipboardImage, fetchImageFromUrl,
} from "@/lib/image-utils";
```

### `format.ts`

```ts
import { convertFormat, convertAndDownload } from "@/lib/format";
// convertAndDownload downloads (Chromium-friendly). Use convertFormat for in-memory.
```

### `history.ts`

```ts
import {
  recordInquiry, loadHistory, saveHistory,
  deleteInquiry, toggleFavorite,
  restoreBlob, rebuildThumbnails,
  type HistoryEntry,
} from "@/lib/history";
```

## PWA manifest

`public/manifest.webmanifest` declares the Inquisitor as a standalone
PWA with vintage-themed icons and two shortcuts:

- `/?action=camera` — open the lens immediately
- `/?view=history` — open the records drawer

## Service Worker

`public/sw.js` is a network-first-then-cache strategy for navigation
and stale-while-revalidate for static assets. The app shell survives
offline reloads; URL-mode engines obviously require network to
function.

## No backend aggregations

The directive asked for `/api/aggregate-search` that pulled all 518
services into a ranked JSON payload. Freebuff doesn't run live
Node/Playwright, so the Inquisitor's "aggregation" is **the
client-side dispatcher**: 40 services in 4 tiers, dispatched in
parallel via hidden forms + `window.open`, with their results left in
the standard browser tabs. This is the closest feasible analog inside
this environment and is also strictly more private.
