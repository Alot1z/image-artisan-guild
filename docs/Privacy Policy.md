# Privacy Policy

## Image handling

The browser processes EXIF, palette, perceptual hash, crop, and OCR locally where possible. A hosted copy is created only when the aggregate proxy needs a public URL. Convex records the hosted blob for cleanup and deletes it after 24 hours.

## Search history

Search history is stored in the user’s browser through IndexedDB. Aggregate results are kept in the current React session and are not written to Convex.

## External proxy

The proxy receives the hosted image URL and selected engine IDs. It is responsible for provider adapters, queueing, deduplication, retention, and legal compliance. Configure it with `RIS_PROXY_URL` and `RIS_PROXY_KEY` in the Keys tab; never commit credentials.

## User control

Users can clear browser history through the Records panel and can remove hosted images automatically through the scheduled cleanup process. Do not upload material you are not authorized to investigate.
