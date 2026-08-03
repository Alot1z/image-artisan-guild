# Privacy Policy

The Image Inquisitor takes a deliberately narrow view of data: it
keeps only the bare minimum it needs to make your next session useful,
and pushes everything else to the user's own browser.

## What we keep

| Data | Where | Lifetime | Why |
|---|---|---|---|
| Image blobs (the plates you lodge) | `IndexedDB` (`inquisitor.images`) | Until you delete the matching history entry | Re-dispatch without re-uploading |
| History metadata (fileName, prompt, notes, engines used, hostedUrl, thumbnail) | `localStorage` (`inquisitor:history:v1`) | Until you clear the records drawer | Records-drawer UX |
| Perceptual hash (64-bit aHash) | in-memory only | Until the page reloads | Duplicate detection inside the current session |
| EXIF + GPS lat/lon | in-memory only | Until the page reloads | Region-aware engine auto-tick |
| Palette swatches | in-memory only | Until the page reloads | Dynamic UI tinting |
| Service worker cache | browser cache | Until cleared | Offline app-shell access |
| Hosted image URL (Convex storage) | Convex storage | Until purged; see below | Required input to URL-based engines |

## What we DO NOT do

- **No analytics, no tracking pixels, no third-party cookies.** The only
  third-party network requests are the search engines you choose to
  dispatch to, and they're opened in a fresh tab like a normal browser
  search.
- **No Convex user-account storage of images or search history.** The
  Convex backend is used solely as an **ephemeral image host** for
  URL-mode engines. No history rows are written to the Convex database.
- **No fingerprinting, no telemetry.** Even the Convex auth flow is
  optional and used only to keep you signed-in between deploys.

## Ephemeral image host

URL-mode engines (Bing, Yandex, Naver, Sogou, Baidu, Pinterest,
Shutterstock, etc.) need a publicly reachable image URL. To give them
one, the Inquisitor uploads your plate through the Convex `storeImage`
action, which:

1. Decodes the dataURL into a `Blob`.
2. Writes the blob to Convex storage and returns the hosted URL.
3. Returns the URL to the Inquisitor so it can plug it into the engine's
   URL template.

The hosted URL is **not** automatically purged by the server. To
satisfy the "no persistent store of user data" promise:

- The hosted URL is **single-use** in our UI: dispatching once reads
  the URL once, and after the engine opens, the URL is no longer
  referenced from the UI (newly dispatched plates get fresh URLs).
- Users can wipe the registry at any time by clearing IndexedDB and
  localStorage (the "Records" drawer has a Delete control per
  record).
- We expose a server-side cleanup that future versions can run via a
  scheduled cron (not enabled in the current build to stay
  reproducible).

## Browser-only history

Search history is intentionally a browser-local concept:

- It is stored in IndexedDB for the blobs and localStorage for the
  metadata.
- It is never sent to the server.
- It is never shared between browsers or accounts.
- Clearing your browser storage deletes it forever.

## iOS / PWA note

When the Inquisitor is added to the iOS home screen, iOS treats it
like a native app for data-storage purposes. The IndexedDB blob store
follows the regular WebKit quota and is wiped when the user removes
the PWA.

## Contact

This is a single-operator Freebuff repo. For privacy questions please
open an issue on the upstream repository.
