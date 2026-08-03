// Plate Cropper — vintage trimming station for refining what the engine sees.
// Supports freehand and preset aspect ratios; returns a cropped Blob.
import { useEffect, useRef, useState, useCallback } from "react";
import { Check, X, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InquiryAsset } from "@/lib/inquiry-store";

interface CropperProps {
  asset: InquiryAsset;
  open: boolean;
  onClose: () => void;
  onCropped: (assetId: string, croppedBlob: Blob) => void;
}

const PRESETS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "1∶1", ratio: 1 },
  { label: "4∶3", ratio: 4 / 3 },
  { label: "16∶9", ratio: 16 / 9 },
  { label: "3∶2", ratio: 3 / 2 },
  { label: "2∶3", ratio: 2 / 3 },
];

export function Cropper({ asset, open, onClose, onCropped }: CropperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS[0]);
  const [zone, setZone] = useState({ x: 20, y: 20, w: 60, h: 60 });
  type DragHandle = "tl" | "tr" | "bl" | "br" | "move";
  const [dragging, setDragging] = useState<DragHandle | null>(null);
  const [dragStart, setDragStart] = useState({ mx: 0, my: 0, zx: 0, zy: 0, zw: 0, zh: 0 });
  const [rotation, setRotation] = useState(0);

  // Load the image bitmap
  useEffect(() => {
    if (!open) return;
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.src = asset.url;
    i.onload = () => {
      setImg(i);
      setZone({ x: 10, y: 10, w: 80, h: 80 });
      setRotation(0);
      setPreset(PRESETS[0]);
    };
    return () => { i.onload = null; };
  }, [asset.url, open]);

  // Draw to canvas
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 2);
    const h = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);

    // Background dim
    ctx.fillStyle = "rgba(42,36,32,0.55)";
    ctx.fillRect(0, 0, w, h);

    // Compute image placement (contain)
    const imgAr = img.naturalWidth / img.naturalHeight;
    const cnvAr = w / h;
    let iw: number, ih: number, ix: number, iy: number;
    if (imgAr > cnvAr) {
      iw = w;
      ih = w / imgAr;
      ix = 0;
      iy = (h - ih) / 2;
    } else {
      ih = h;
      iw = ih * imgAr;
      iy = 0;
      ix = (w - iw) / 2;
    }

    // Rotation transform
    if (rotation % 360 !== 0) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-w / 2, -h / 2);
    }

    // Draw full image (lightened)
    ctx.globalAlpha = 0.65;
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.globalAlpha = 1;

    // Crop zone in canvas coords (zone is %)
    const zx = (zone.x / 100) * w;
    const zy = (zone.y / 100) * h;
    const zw = (zone.w / 100) * w;
    const zh = (zone.h / 100) * h;

    // Draw cropped region bright via an off-screen canvas
    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const offCtx = off.getContext("2d");
    if (offCtx) {
      // Map zone to image coords
      const sx = ((zone.x / 100) * w - ix) / iw * img.naturalWidth;
      const sy = ((zone.y / 100) * h - iy) / ih * img.naturalHeight;
      const sw = (zw / iw) * img.naturalWidth;
      const sh = (zh / ih) * img.naturalHeight;
      offCtx.drawImage(img, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, off.width, off.height);
    }

    if (rotation % 360 !== 0) ctx.restore();

    // Light box showing the crop
    ctx.globalAlpha = 0.4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(zx, zy, zw, zh);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.globalAlpha = 1;

    // Crop box border
    ctx.strokeStyle = "#d4b886";
    ctx.lineWidth = 2;
    ctx.strokeRect(zx, zy, zw, zh);

    // Corner brackets
    const b = 12;
    ctx.strokeStyle = "#f3e2bf";
    ctx.lineWidth = 2.5;
    [
      [zx, zy, 1, 1],
      [zx + zw, zy, -1, 1],
      [zx, zy + zh, 1, -1],
      [zx + zw, zy + zh, -1, -1],
    ].forEach(([cx, cy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(cx as number, (cy as number) + b * (dy as number));
      ctx.lineTo(cx as number, cy as number);
      ctx.lineTo((cx as number) + b * (dx as number), cy as number);
      ctx.stroke();
    });

    if (rotation % 360 !== 0) ctx.restore();

    // Grid overlay
    ctx.strokeStyle = "rgba(243,226,191,0.15)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(zx + (zw * i) / 3, zy);
      ctx.lineTo(zx + (zw * i) / 3, zy + zh);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(zx, zy + (zh * i) / 3);
      ctx.lineTo(zx + zw, zy + (zh * i) / 3);
      ctx.stroke();
    }
  }, [img, zone, rotation, preset]);

  // Mouse handlers for drag/resize
  const handlePointerDown = useCallback((e: React.PointerEvent, handle: DragHandle) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(handle);
    setDragStart({ mx: e.clientX, my: e.clientY, zx: zone.x, zy: zone.y, zw: zone.w, zh: zone.h });
  }, [zone]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dxPct = ((e.clientX - dragStart.mx) / (containerRef.current?.offsetWidth ?? 400)) * 100;
      const dyPct = ((e.clientY - dragStart.my) / (containerRef.current?.offsetHeight ?? 400)) * 100;

      let nx = dragStart.zx;
      let ny = dragStart.zy;
      let nw = dragStart.zw;
      let nh = dragStart.zh;

      switch (dragging) {
        case "move":
          nx = Math.max(0, Math.min(100 - nw, dragStart.zx + dxPct));
          ny = Math.max(0, Math.min(100 - nh, dragStart.zy + dyPct));
          break;
        case "tl":
          nx = Math.max(0, Math.min(dragStart.zx + dragStart.zw - 8, dragStart.zx + dxPct));
          ny = Math.max(0, Math.min(dragStart.zy + dragStart.zh - 8, dragStart.zy + dyPct));
          nw = dragStart.zx + dragStart.zw - nx;
          nh = dragStart.zy + dragStart.zh - ny;
          break;
        case "tr":
          nw = Math.max(8, Math.min(100 - dragStart.zx, dragStart.zw + dxPct));
          ny = Math.max(0, Math.min(dragStart.zy + dragStart.zh - 8, dragStart.zy + dyPct));
          nh = dragStart.zy + dragStart.zh - ny;
          break;
        case "bl":
          nx = Math.max(0, Math.min(dragStart.zx + dragStart.zw - 8, dragStart.zx + dxPct));
          nw = dragStart.zx + dragStart.zw - nx;
          nh = Math.max(8, Math.min(100 - dragStart.zy, dragStart.zh + dyPct));
          break;
        case "br":
          nw = Math.max(8, Math.min(100 - dragStart.zx, dragStart.zw + dxPct));
          nh = Math.max(8, Math.min(100 - dragStart.zy, dragStart.zh + dyPct));
          break;
      }

      if (preset.ratio) {
        const ar = preset.ratio;
        // Apply aspect ratio constraint
        const cw = (nx + nw / 2);
        const ch = (ny + nh / 2);
        const clampedW = Math.min(nh * ar, (nw + nh * ar) / 2);
        nh = clampedW / ar;
        nw = clampedW;
        nx = Math.max(0, Math.min(100 - nw, cw - nw / 2));
        ny = Math.max(0, Math.min(100 - nh, ch - nh / 2));
      }

      setZone({ x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10, w: Math.round(nw * 10) / 10, h: Math.round(nh * 10) / 10 });
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, dragStart, preset.ratio]);

  if (!open) return null;

  const applyCrop = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    const sx = (zone.x / 100) * img.naturalWidth;
    const sy = (zone.y / 100) * img.naturalHeight;
    const sw = (zone.w / 100) * img.naturalWidth;
    const sh = (zone.h / 100) * img.naturalHeight;
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (rotation % 360 !== 0) {
      ctx.translate(sw / 2, sh / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-sw / 2, -sh / 2);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob((b) => {
      if (b) onCropped(asset.id, b);
      onClose();
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_80%,transparent)]/85 p-2 backdrop-blur">
      <div className="archive-card relative flex h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="stamp">✂</span>
            <div>
              <p className="eyebrow">The Cropping Table</p>
              <p className="font-display text-lg italic">Trim before inquiry</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPreset(p)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.65rem] font-display uppercase tracking-wider transition",
                    preset.label === p.label ? "bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)]" : "text-[color-mix(in_oklab,var(--ink)_75%,transparent)]",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button size="icon" variant="ghost" title="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)} className="text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} className="text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Canvas area */}
        <div ref={containerRef} className="relative flex-1 select-none touch-none overflow-hidden">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ touchAction: "none" }} />

          {/* Drag handles */}
          {(["tl", "tr", "bl", "br", "move"] as DragHandle[]).map((h) => (
            <div
              key={h}
              onPointerDown={(e) => handlePointerDown(e, h)}
              className={cn(
                "absolute z-10",
                h === "move"
                  ? "inset-[10%] cursor-move border-2 border-transparent"
                  : cn(
                    "h-10 w-10 rounded-full",
                    h === "tl" && "left-[18%] top-[18%] cursor-nw-resize",
                    h === "tr" && "left-[82%] top-[18%] cursor-ne-resize",
                    h === "bl" && "left-[18%] top-[82%] cursor-sw-resize",
                    h === "br" && "left-[82%] top-[82%] cursor-se-resize",
                  ),
              )}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[color-mix(in_oklab,var(--ink)_25%,transparent)] px-4 py-3">
          <div className="text-[0.7rem] font-body-serif italic text-[color-mix(in_oklab,var(--ink)_72%,transparent)]">
            {rotation % 360 !== 0 ? `${rotation}° ` : ""}{preset.label} {zone.w.toFixed(0)}% × {zone.h.toFixed(0)}%
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="gap-1 rounded-full border-[color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color-mix(in_oklab,var(--paper-tint)_65%,transparent)] font-display italic">
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" onClick={applyCrop} className="gap-1 rounded-full bg-[color-mix(in_oklab,var(--seal)_55%,var(--ink)_45%)] font-display text-[color-mix(in_oklab,var(--paper-tint)_95%,transparent)] hover:opacity-90">
              <Check className="h-3.5 w-3.5" /> Accept crop
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
