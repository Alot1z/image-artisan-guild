# The Image Inquisitor — Wiki

A vintage-styled, mobile-first, installable reverse-image engineering
workbench. The Wiki below explains its pieces and how to extend them.

| Page | What it covers |
|---|---|
| [Architecture](./architecture.md) | Component map, data flow, runtime topology |
| [Adding New Services](./adding-services.md) | How to register a new reverse-image engine into the Catalogue |
| [Privacy Policy](./privacy.md) | What we keep, where we keep it, and what is thrown away |
| [Vintage Design System](./vintage-design-system.md) | Tokens, type, texture — and how to theme new components |
| [API Reference](./api-reference.md) | Convex action surface (host-only) and in-browser helpers |

## At a glance

The Inquisitor is a single-page React app on the Freebuff stack:

- **Vite + React 19** for the UI shell
- **Tailwind v4** (custom vintage tokens in `src/index.css`)
- **Convex** for an ephemeral image host (`storeImage` action)
- **IndexedDB** + `localStorage` for per-browser history
- **Service Worker** for offline caching of the app shell + vintage fonts

Five entry modes (camera, gallery, web, files, clipboard), drag-and-drop
or paste-anywhere, EXIF GPS auto-tagging, palette extraction, perceptual
hash, format converter, cropper, and a 40-engine catalogue grouped into
four tiers.
