// Inquiry state shared by the workbench components. We use a small store
// implementation backed by React state + IndexedDB persistence so that
// refreshes do not lose the queue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadHistory,
  recordInquiry,
  toggleFavorite as toggleFavoriteStore,
  deleteInquiry as deleteInquiryStore,
  rebuildThumbnails,
  restoreBlob,
  type HistoryEntry,
} from "@/lib/history";
import { perceptualHash, similarityPercent } from "@/lib/phash";
import { extractPalette, type Swatch } from "@/lib/palette";
import { readExif, type ExifData } from "@/lib/exif";
import { blobToDataUrl } from "@/lib/image-utils";
import { ALL_ENGINE_IDS } from "@/lib/engines";

export interface InquiryAsset {
  id: string;
  source: "camera" | "gallery" | "web" | "files" | "clipboard" | "drag" | "sample";
  sourceLabel: string;
  fileName?: string;
  blob: Blob;
  url: string;             // object URL (in-memory)
  thumbnail: string;       // data URL (small)
  width: number;
  height: number;
  size: number;
  rotation: number;
  notes: string;
  palette: Swatch[];
  exif: ExifData;
  hash: string;
  hostedUrl?: string;
  /** Engines currently chosen for this asset. */
  engines: string[];
}

export type SourceLabelMap = Record<InquiryAsset["source"], string>;

export const SOURCE_LABELS: SourceLabelMap = {
  camera: "Captured plate",
  gallery: "Gallery frame",
  web: "Fetched from web",
  files: "Imported file",
  clipboard: "Pasted frame",
  drag: "Dropped frame",
  sample: "Specimen plate",
};

function uid(): string {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function makeThumbnail(blob: Blob, maxDim = 320): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const size = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * size));
  const h = Math.max(1, Math.round(bitmap.height * size));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blobToDataUrl(blob);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export interface Store {
  assets: InquiryAsset[];
  activeId: string | null;
  hostedUrls: Record<string, string>;
  uploading: Record<string, boolean>;
  history: HistoryEntry[];
  busy: boolean;

  setNotes: (id: string, notes: string) => void;
  setEngines: (id: string, engines: string[]) => void;
  setRotation: (id: string, delta: number) => void;
  select: (id: string) => void;
  remove: (id: string) => void;
  add: (source: InquiryAsset["source"], payload: Blob) => Promise<InquiryAsset | null>;
  addFromUrl: (url: string) => Promise<InquiryAsset | null>;
  addFromHistory: (entry: HistoryEntry) => Promise<InquiryAsset | null>;
  setHostedUrl: (id: string, url: string) => void;
  clearHostedUrl: (id: string) => void;
  recordAll: (extras?: { prompt?: string; tags?: string[] }) => Promise<HistoryEntry[]>;
  toggleFavorite: (id: string) => void;
  deleteHistory: (id: string) => void;
  refreshHistory: () => void;
  replaceAsset: (id: string, partial: Partial<InquiryAsset>) => void;
}

export function useInquiryStore(): Store {
  const [assets, setAssets] = useState<InquiryAsset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hostedUrls, setHostedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const thumbCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    rebuildThumbnails();
    setHistory(loadHistory());
  }, []);

  const add = useCallback(async (source: InquiryAsset["source"], payload: Blob) => {
    if (!payload || !(payload instanceof Blob) || payload.size === 0) return null;
    setBusy(true);
    const id = uid();
    const url = URL.createObjectURL(payload);
    let width = 0, height = 0;
    try {
      const bitmap = await createImageBitmap(payload);
      width = bitmap.width; height = bitmap.height;
    } catch {
      /* ignore */
    }
    const thumb = await makeThumbnail(payload);
    thumbCache.current.set(id, thumb);

    let palette: Swatch[] = [];
    let exif: ExifData = {};
    let hash = "";
    try { palette = await extractPalette(payload, 5); } catch { /* ignore */ }
    if (/jpe?g/i.test(payload.type) || /\.(jpe?g)$/i.test((payload as File).name ?? "")) {
      try { exif = await readExif(payload); } catch { /* ignore */ }
    }
    try { hash = await perceptualHash(payload); } catch { /* ignore */ }

    const asset: InquiryAsset = {
      id,
      source,
      sourceLabel: SOURCE_LABELS[source],
      fileName: payload instanceof File ? payload.name : undefined,
      blob: payload,
      url,
      thumbnail: thumb,
      width,
      height,
      size: payload.size,
      rotation: 0,
      notes: "",
      palette,
      exif,
      hash,
      // Default state: every available engine is pre-ticked. The user keeps
      // the maximum power engine out of the box, and can shed any service
      // from the Advanced Options panel.
      engines: [...ALL_ENGINE_IDS],
    };
    setAssets((prev) => {
      const next = [...prev, asset];
      if (!activeId) setActiveId(id);
      return next;
    });
    if (!activeId) setActiveId(id);
    setBusy(false);
    return asset;
  }, [activeId]);

  const addFromUrl = useCallback(async (url: string) => {
    try {
      const { fetchImageFromUrl } = await import("@/lib/image-utils");
      const blob = await fetchImageFromUrl(url);
      return add("web", blob);
    } catch (err) {
      console.error("fetch failed", err);
      return null;
    }
  }, [add]);

  const addFromHistory = useCallback(async (entry: HistoryEntry) => {
    const asset = await hydrateAsset(entry);
    if (!asset) return null;
    setAssets((prev) => {
      const exists = prev.some((a) => a.id === asset.id);
      return exists ? prev.map((a) => a.id === asset.id ? { ...a, ...asset } : a) : [...prev, asset];
    });
    setActiveId(asset.id);
    if (asset.hostedUrl) setHostedUrls((p) => ({ ...p, [asset.id]: asset.hostedUrl! }));
    return asset;
  }, []);

  const remove = useCallback((id: string) => {
    setAssets((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId]);

  const select = useCallback((id: string) => setActiveId(id), []);

  const setRotation = useCallback((id: string, delta: number) => {
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, rotation: (a.rotation + delta) % 360 } : a));
  }, []);

  const setNotes = useCallback((id: string, notes: string) => {
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, notes } : a));
  }, []);

  const setEngines = useCallback((id: string, engines: string[]) => {
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, engines } : a));
  }, []);

  const replaceAsset = useCallback((id: string, partial: Partial<InquiryAsset>) => {
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, ...partial } : a));
  }, []);

  const setHostedUrl = useCallback((id: string, url: string) => {
    setHostedUrls((prev) => ({ ...prev, [id]: url }));
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, hostedUrl: url } : a));
  }, []);

  const clearHostedUrl = useCallback((id: string) => {
    setHostedUrls((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setAssets((prev) => prev.map((a) => a.id === id ? { ...a, hostedUrl: undefined } : a));
  }, []);

  const recordAll = useCallback(async (extras?: { prompt?: string; tags?: string[] }) => {
    const entries: HistoryEntry[] = [];
    for (const asset of assets) {
      const entry = await recordInquiry({
        blob: asset.blob,
        thumbnail: asset.thumbnail,
        width: asset.width,
        height: asset.height,
        source: asset.source,
        engines: asset.engines,
        fileName: asset.fileName,
        notes: asset.notes,
        hostedUrl: hostedUrls[asset.id] ?? asset.hostedUrl,
        prompt: extras?.prompt,
      });
      entries.push(entry);
    }
    setHistory((prev) => [...entries, ...prev].slice(0, 200));
    return entries;
  }, [assets, hostedUrls]);

  const toggleFavorite = useCallback((id: string) => {
    setHistory(toggleFavoriteStore(id));
  }, []);

  const deleteHistory = useCallback((id: string) => {
    setHistory(deleteInquiryStore(id));
  }, []);

  const refreshHistory = useCallback(() => setHistory(loadHistory()), []);

  // Compute duplicates among current assets by perceptual hash.
  const _hashMemo = useMemo(() => {
    const m: Record<string, { a: string; b: string; pct: number } | null> = {};
    for (let i = 0; i < assets.length; i++) {
      for (let j = i + 1; j < assets.length; j++) {
        const a = assets[i]; const b = assets[j];
        if (!a.hash || !b.hash) continue;
        m[`${a.id}:${b.id}`] = { a: a.hash, b: b.hash, pct: similarityPercent(a.hash, b.hash) };
      }
    }
    return m;
  }, [assets]);
  void _hashMemo;

  return {
    assets,
    activeId,
    hostedUrls,
    uploading,
    history,
    busy,
    setNotes,
    setEngines,
    setRotation,
    select,
    remove,
    add,
    addFromUrl,
    addFromHistory,
    setHostedUrl,
    clearHostedUrl,
    recordAll,
    toggleFavorite,
    deleteHistory,
    refreshHistory,
    replaceAsset,
  };
}

export async function hydrateAsset(entry: HistoryEntry): Promise<InquiryAsset | null> {
  const blob = await restoreBlob(entry);
  if (!blob) return null;
  let width = 0, height = 0;
  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width; height = bitmap.height;
  } catch { /* ignore */ }
  const url = URL.createObjectURL(blob);
  const thumb = entry.thumbnail || await makeThumbnail(blob);
  let palette: Swatch[] = [];
  let exif: ExifData = {};
  let hash = "";
  try { palette = await extractPalette(blob, 5); } catch { /* ignore */ }
  try { exif = await readExif(blob); } catch { /* ignore */ }
  try { hash = await perceptualHash(blob); } catch { /* ignore */ }
  return {
    id: entry.id,
    source: entry.source,
    sourceLabel: SOURCE_LABELS[entry.source],
    fileName: entry.fileName,
    blob,
    url,
    thumbnail: thumb,
    width,
    height,
    size: blob.size,
    rotation: 0,
    notes: entry.notes ?? "",
    palette,
    exif,
    hash,
    engines: entry.engines ?? [...ALL_ENGINE_IDS],
    hostedUrl: entry.hostedUrl,
  };
}
