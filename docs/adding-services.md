# Adding New Services

Each reverse-image engine is one row in `src/lib/engines.ts`. The
registry carries the engine's strategy, region tag, and UI hint. To add
a new service:

1. Open `src/lib/engines.ts`.
2. Append a new `Engine` to the `ENGINES` array in the appropriate tier
   (1 = General, 2 = Facial/AI, 3 = E-Commerce/Stock, 4 = Niche/Anime).
3. Pick a `mark` glyph (1-3 chars) — that's the badge shown when we have
   no remote icon.
4. Set `availability` (`free` | `freemium` | `login` | `flaky`) so the
   user understands the cost.

## Catalog format

```ts
{
  id: "saucenao",                           // unique slug
  name: "SauceNAO",                         // display name
  description: "Anime & illustration source finder.",
  tier: 4,                                  // 1, 2, 3, or 4
  region: "global",                         // regional bias for GPS hints
  feature: "anime",                         // sub-category chip
  mode: "form-upload",                      // or "url-open"
  upload: {                                 // only for form-upload
    endpoint: "https://saucenao.com/search.php",
    fieldName: "image",
    extras: { frame: "1", hide: "0" },      // optional hidden fields
  },
  // urlBuilder: (imageUrl: string) => string,  // only for url-open
  mark: "S",                                // UI badge
  needsHost: true,                          // (url-open) needs hosted URL
  availability: "free",                     // or freemium / login / flaky
}
```

### mode: `form-upload`

Build a hidden `<form>` with `enctype="multipart/form-data"`, set
`action = engine.upload.endpoint`, set `target = "_blank"`, then call
`form.submit()`. Engines like SauceNAO, TinEye, PimEyes, FindClone,
eBay, AliExpress all behave this way.

### mode: `url-open`

Build a URL with `engine.urlBuilder(hostedImageUrl)`. The hosted URL
must be publicly reachable. We use Convex storage for that (see
`storeImage` in `src/convex/inquiries.ts`); the result is then opened
in a new tab.

### Region tags

Used to support the **EXIF GPS → regional engines** auto-tick. Choose
the most-specific tag the engine prioritises:

| Region | Examples |
|---|---|
| `global` | Google Lens, TinEye, Bing, SauceNAO |
| `east-asia` | Baidu, Sogou, Naver, Qihoo, ASCII2D, trace.moe |
| `russia` | Yandex, Mail.ru, FindClone, Search4Faces |
| `europe` | Ecosia, ... |
| `americas` | Karma Decay (Reddit-centric) |
| `mena` | (none yet) |

`src/lib/region.ts` exposes `suggestedEngineIds(geoPoint)` which returns
the IDs we pre-tick when EXIF GPS reveals an origin.

### Feature sub-categories

`general | face | stock | product | anime | art | duplicate | ocr` —
shown as a small chip inside each engine tile and used by the History
filter bar (`Face` / `Exact Match` / `E-Commerce` / `Anime` / `Stock`).

## Examples

**Adding a new niche engine (URL-based):**

```ts
{
  id: "whatimg-is",
  name: "WhatImg.is",
  description: "Multi-engine reverse-image metasearch.",
  tier: 4, region: "global", feature: "general",
  mode: "url-open",
  needsHost: true,
  urlBuilder: (url) => `https://whatimg.is/?url=${encodeURIComponent(url)}`,
  mark: "WI", availability: "free",
}
```

**Adding an upload-style stock search:**

```ts
{
  id: "stockvault",
  name: "StockVault",
  description: "Free-stock reverse photo search.",
  tier: 3, region: "global", feature: "stock",
  mode: "form-upload",
  upload: { endpoint: "https://www.stockvault.com/search", fieldName: "image" },
  mark: "SV", availability: "free",
}
```

Restart the dev server (`bun` re-mounts with HMR) and the new engine
will appear in the Catalogue and become selectable.
