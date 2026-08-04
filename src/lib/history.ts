// History persistence — uses IndexedDB to store image blobs keyed by inquiry ID,
// plus localStorage for lightweight metadata so the gallery can be listed
// without loading every full image.

import { blobToDataUrl, dataUrlToBlob } from "./image-utils";

export interface HistoryEntry {
  id: string;
  createdAt: number;
  thumbnail: string; // data URL (small)
  width: number;
  height: number;
  size: number;
  prompt?: string;
  engines: string[]; // engine ids used
  source: "camera" | "gallery" | "web" | "files" | "clipboard" | "drag" | "sample";
  notes?: string;
  favorited?: boolean;
  fileName?: string;
  /** Stored URL when the image was uploaded via Convex storage — useful for re-dispatch. */
  hostedUrl?: string;
  /** Local timestamp (ms) when the hosted URL was created, used to estimate expiry. */
  hostedAt?: number;
}

/**
 * Approximate lifetime of hosted uploads — mirrors the Convex purge TTL
 * (HOSTED_TTL_MS in src/convex/inquiries.ts). Kept here as a plain constant
 * so UI code never needs to import server-side modules.
 */
export const HOSTED_URL_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Best-effort staleness check for a hosted URL. Without a recorded hostedAt
 * (pre-Phase-10 records) the age is unknown, so the URL is treated as
 * expired rather than presented as currently usable.
 */
export function isHostedUrlExpired(hostedAt?: number): boolean {
  if (!hostedAt) return true;
  return Date.now() - hostedAt > HOSTED_URL_LIFETIME_MS;
}

const DB_NAME = "inquisitor";
const DB_VERSION = 1;
const STORE = "images";
const META_KEY = "inquisitor:history:v1";
const FAV_KEY = "inquisitor:favorites:v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBlob(id: string, blob: Blob): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteBlob(id: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getBlob(id: string): Promise<Blob | null> {
  if (!isBrowser()) return null;
  const db = await openDB();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export function loadHistory(): HistoryEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function loadFavorites(): HistoryEntry[] {
  return loadHistory().filter((e) => e.favorited);
}

export function saveHistory(entries: HistoryEntry[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

export async function recordInquiry(args: {
  blob: Blob;
  thumbnail: string;
  width: number;
  height: number;
  source: HistoryEntry["source"];
  engines: string[];
  fileName?: string;
  prompt?: string;
  notes?: string;
  hostedUrl?: string;
  hostedAt?: number;
}): Promise<HistoryEntry> {
  const id = `inq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await putBlob(id, args.blob);

  const entry: HistoryEntry = {
    id,
    createdAt: Date.now(),
    thumbnail: args.thumbnail,
    width: args.width,
    height: args.height,
    size: args.blob.size,
    source: args.source,
    engines: args.engines,
    fileName: args.fileName,
    prompt: args.prompt,
    notes: args.notes,
    favorited: false,
    hostedUrl: args.hostedUrl,
    hostedAt: args.hostedAt,
  };

  const prev = loadHistory();
  saveHistory([entry, ...prev].slice(0, 200));
  return entry;
}

export async function restoreBlob(entry: HistoryEntry): Promise<Blob | null> {
  const fromId = await getBlob(entry.id);
  if (fromId) return fromId;
  if (entry.thumbnail) return dataUrlToBlob(entry.thumbnail);
  return null;
}

export function toggleFavorite(id: string): HistoryEntry[] {
  const list = loadHistory().map((e) =>
    e.id === id ? { ...e, favorited: !e.favorited } : e,
  );
  saveHistory(list);
  return list;
}

/**
 * Delete a record: removes the localStorage metadata AND the matching
 * IndexedDB blob so blobs no longer accumulate as orphans.
 */
export async function deleteInquiry(id: string): Promise<HistoryEntry[]> {
  const list = loadHistory().filter((e) => e.id !== id);
  saveHistory(list);
  await deleteBlob(id).catch(() => {
    /* Blob cleanup is best-effort; a later reconciliation pass sweeps strays. */
  });
  return list;
}

/**
 * Sweep IndexedDB: remove any stored blob whose id no longer has a matching
 * history record. Runs once on app load to clean up pre-Phase-10 orphans.
 */
export async function reconcileOrphanedBlobs(): Promise<number> {
  if (!isBrowser()) return 0;
  const known = new Set(loadHistory().map((e) => e.id));
  const db = await openDB();
  const orphans = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as (string | number)[]).filter((k) => !known.has(String(k))).map(String));
    req.onerror = () => reject(req.error);
  });
  if (orphans.length > 0) {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of orphans) store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  db.close();
  return orphans.length;
}

/**
 * Rebuild only the thumbnails that are missing, while persisting the FULL
 * history list so no existing metadata (favorites, notes, hosted URLs,
 * timestamps) is ever dropped.
 */
export async function rebuildThumbnails(): Promise<void> {
  const list = loadHistory();
  let changed = false;
  for (const e of list) {
    if (e.thumbnail) continue;
    const blob = await getBlob(e.id);
    if (!blob) continue;
    try {
      e.thumbnail = await blobToDataUrl(blob);
      changed = true;
    } catch {
      /* ignore */
    }
  }
  if (changed) saveHistory(list);
}

/**
 * Patch a history record's hosted URL in place (used by the re-host flow)
 * and stamp the new upload time locally. Returns the updated list.
 */
export function updateHistoryHostedUrl(id: string, url: string): HistoryEntry[] {
  const list = loadHistory().map((e) =>
    e.id === id ? { ...e, hostedUrl: url, hostedAt: Date.now() } : e,
  );
  saveHistory(list);
  return list;
}

export const HISTORY_KEYS = { META_KEY, FAV_KEY, STORE };
