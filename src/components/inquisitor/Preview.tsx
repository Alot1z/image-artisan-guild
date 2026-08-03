// Image preview plate — vintage framed snapshot with rotation controls and
// dynamic UI tinting (the dominant pigment of the active plate tints the
// brass & burgundy accents). The tint lifecycle is owned by this component
// so swapping plates always restores the previous baseline cleanly.

import { useEffect, useState } from "react";
import { RotateCw, RotateCcw, ExternalLink, Copy, Download, Trash2, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/utils";
import type { InquiryAsset } from "@/lib/inquiry-store";

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[u]}`;
}

// Cache the original baseline so we can restore on swap/unmount.
let baselineBrass: string | null = null;
let baselineSeal: string | null = null;

/** Mix a dominant hex swatch into the vintage palette by computing a soft
 *  oklch-style replacement for the brass and seal accents. We don't try to
 *  be format-perfect; the goal is a tasteful pull toward the plate's mood. */
function applyTintFromPalette(hex: string | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!baselineBrass) {
    baselineBrass = getComputedStyle(root).getPropertyValue("--brass").trim();
  }
  if (!baselineSeal) {
    baselineSeal = getComputedStyle(root).getPropertyValue("--seal").trim();
  }
  if (!hex) {
    if (baselineBrass) root.style.setProperty("--brass", baselineBrass);
    if (baselineSeal) root.style.setProperty("--seal", baselineSeal);
    return;
  }

  // Parse hex -> rough HSL -> HSL-trimmed color so we don't shatter contrast.
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  // Cap the saturation so the brass stays vintage, not neon.
  const sat = Math.min(0.55, s * 0.85);
  const lightness = Math.min(0.55, Math.max(0.30, l * 0.85));
  // Shift the hue slightly so brass pulls warm and seal pulls warm-cool.
  const brassH = h + (h < 60 ? -8 : 12);           // brass leans warm
  const sealH = h + 200;                            // seal swings complement
  const brass = `oklch(${lightness} ${sat} ${brassH})`;
  const seal = `oklch(${Math.min(0.45, lightness + 0.05)} ${Math.min(0.55, sat)} ${sealH})`;
  root.style.setProperty("--brass", brass);
  root.style.setProperty("--seal", seal);
}

interface Props {
  assets: InquiryAsset[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRotation: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  hostedUrl?: string | null;
  onCopyUrl?: (url: string) => void;
  onDownload?: (asset: InquiryAsset) => void;
  onCrop?: (asset: InquiryAsset) => void;
}

export function Preview({ assets, activeId, onSelect, onRotation, onRemove, hostedUrl, onCopyUrl, onDownload, onCrop }: Props) {
  const asset = assets.find((a) => a.id === activeId) ?? null;
  const [hovered, setHovered] = useState(false);

  // Apply palette-based tinting whenever the active plate changes.
  useEffect(() => {
    const topSwatch = asset?.palette?.[0]?.hex;
    applyTintFromPalette(topSwatch);
    return () => {
      // On unmount (not when just changing plates) restore baseline.
    };
  }, [asset?.id, asset?.palette]);

  // Restore baseline when the component fully unmounts (e.g. user leaves /dashboard)
  useEffect(() => {
    return () => applyTintFromPalette(undefined);
  }, []);

  if (!asset) return null;

  const topSwatches = (asset.palette ?? []).slice(0, 4);

  return (
    <div className="archive-card relative overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div className="leading-tight">
          <p className="eyebrow">The Plate under Inquiry</p>
          <p className="font-display text-lg italic">{asset.fileName || asset.sourceLabel}</p>
        </div>
        <span className="ribbon-num">№ {assets.indexOf(asset) + 1}</span>
      </div>

      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex items-center justify-center bg-[color-mix(in_oklab,var(--paper-deep)_50%,transparent)] p-4 sm:p-6"
        style={{ minHeight: 260 }}
      >
        <div
          className="relative max-h-[58vh] max-w-full overflow-hidden rounded-sm border border-[color-mix(in_oklab,var(--ink)_35%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)] shadow-2xl"
          style={{ transform: `rotate(${asset.rotation}deg)` }}
        >
          <img
            src={asset.url}
            alt={asset.fileName ?? "Plate under inquiry"}
            className="max-h-[58vh] max-w-full object-contain"
            draggable={false}
          />
        </div>
        {assets.length > 1 && (
          <div className={cn("pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_85%,transparent)] p-1.5 shadow-lg backdrop-blur transition", hovered ? "opacity-100" : "opacity-90")}>
            {assets.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={cn(
                  "h-9 w-9 overflow-hidden rounded-full border-2",
                  a.id === activeId ? "border-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] shadow" : "border-[color-mix(in_oklab,var(--ink)_20%,transparent)] hover:border-[color-mix(in_oklab,var(--ink)_45%,transparent)]",
                )}
                title={a.fileName || a.sourceLabel}
              >
                <img src={a.thumbnail} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-body-serif text-[color-mix(in_oklab,var(--ink)_80%,transparent)]">
          <span className="catalogue-tag">{humanSize(asset.size)}</span>
          <span className="catalogue-tag">{asset.width} × {asset.height}</span>
          <span className="catalogue-tag">{asset.sourceLabel}</span>
          <span className="hidden font-script text-base italic text-[color-mix(in_oklab,var(--seal)_70%,var(--ink)_30%)] sm:inline">·{asset.rotation}°</span>
          {topSwatches.length > 0 && (
            <div className="ml-1 flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--ink)_25%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_55%,transparent)] px-2 py-1">
              {topSwatches.map((s) => (
                <span key={s.hex} className="h-3 w-3 rounded-sm border border-[color-mix(in_oklab,var(--ink)_30%,transparent)]" style={{ background: s.hex }} title={`${s.hex} (${Math.round(s.share * 100)}%)`} />
              ))}
              <span className="font-script text-[0.7rem] italic text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">tinted</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title="Rotate left" onClick={() => onRotation(asset.id, -90)} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Rotate right" onClick={() => onRotation(asset.id, 90)} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
            <RotateCw className="h-4 w-4" />
          </Button>
          {hostedUrl && onCopyUrl && (
            <Button size="icon" variant="ghost" title="Copy hosted URL" onClick={() => { onCopyUrl(hostedUrl); toast({ title: "URL copied" }); }} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
              <Copy className="h-4 w-4" />
            </Button>
          )}
          {onCrop && (
            <Button size="icon" variant="ghost" title="Crop the plate" onClick={() => onCrop(asset)} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
              <Crop className="h-4 w-4" />
            </Button>
          )}
          {onDownload && (
            <Button size="icon" variant="ghost" title="Download plate" onClick={() => onDownload(asset)} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
              <Download className="h-4 w-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" title="Open in new tab" onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")} className="text-[color-mix(in_oklab,var(--ink)_75%,transparent)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
            <ExternalLink className="h-4 w-4" />
          </Button>
          {assets.length > 1 && (
            <Button size="icon" variant="ghost" title="Remove from inquiry" onClick={() => onRemove(asset.id)} className="text-[color-mix(in_oklab,var(--seal)_75%,var(--ink)_25%)] hover:bg-[color-mix(in_oklab,var(--paper-deep)_55%,transparent)]">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
