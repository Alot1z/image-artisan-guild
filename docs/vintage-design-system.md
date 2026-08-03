# Vintage Design System

A muted sepia / aged-paper aesthetic that the user can read for hours
without eye-strain. There is **no** loud retro gimmickry — no neon
"1950s diner" reds, no "Old Western" rope-and-wood textures. The goal
is editorial, archival, calm.

## Color tokens

All design tokens live in `src/index.css` as CSS custom properties.
They use `oklch()` so dark mode stays perceptually consistent.

```css
:root {
  --paper-tint: oklch(0.94 0.03 70);      /* aged-paper off-white */
  --paper-deep: oklch(0.86 0.04 65);      /* background paper */
  --ink:        oklch(0.30 0.04 50);      /* primary text (sepia) */
  --brass:      oklch(0.55 0.10 70);      /* accent (faded brass) */
  --seal:       oklch(0.40 0.10 25);      /* primary action (burgundy) */
}
.dark {
  --paper-tint: oklch(0.20 0.02 60);
  --paper-deep: oklch(0.16 0.02 60);
  --ink:        oklch(0.92 0.03 70);
  --brass:      oklch(0.70 0.10 70);
  --seal:       oklch(0.65 0.12 25);
}
```

`brass` and `seal` are the only accents — used for buttons, ribbons,
selected states, and tooltips. The Inquisitor **dynamically retints**
both at runtime based on the dominant pigment of the active plate
(see `Preview.tsx → applyTintFromPalette`).

## Typography

The serif hierarchy uses three Google Fonts loaded from `index.html`:

| Role | Font | Weight examples |
|---|---|---|
| Display / titles | Playfair Display | 400, 600, 700 |
| Headings, frame text | Cormorant Garamond (display) | 500, 600 |
| Body, EXIF blocks | EB Garamond (body) | 400, 600 |
| Mono (seals, hashes) | JetBrains Mono | 400 |

Use the utility classes:

- `font-display` → Playfair Display (or Cormorant Garamond ITALIC)
- `font-body-serif` → EB Garamond
- `font-script` → IM Fell English (used for marginalia)
- `font-mono` → JetBrains Mono

## Texture

The grain is an inline SVG `feTurbulence` filter applied through the
`.paper-grain` class. There is also a `.dust` keyframe animation for
the museum-room particle effect on empty states.

## Components

| Class | Purpose |
|---|---|
| `archive-card` | Paper card with hairline border, soft shadow, deckled top edge |
| `plate-hover` | Hover lift + 1px translation + tint shift |
| `catalogue-tag` | Small uppercase pill for metadata |
| `ribbon-num` | Wax-stamp numbered ribbon |
| `stamp` | Roman-numeral wax stamp (used in section headers) |
| `drop-cap` | First-letter enlargement (matches the `T` in our title) |
| `dust` | Single particle for the museum-room drift animation |

## Adding a new component

1. Use the tokens above. Don't hardcode `oklch()` — reference
   `--paper-tint`, `--ink`, `--brass`, `--seal`, and `color-mix(...)`.
2. Background papers: `bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)]`
3. Borders: `border-[color-mix(in_oklab,var(--ink)_25%,transparent)]`
4. Headings: `font-display italic`
5. Body: `font-body-serif`
6. Buttons that look like actions: rounded-full + `bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)]`

That's it — there is no separate Tailwind plugin. The tokens, the
fonts, and the gradient tilts carry the look.
