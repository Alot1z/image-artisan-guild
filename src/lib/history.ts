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

export function deleteInquiry(id: string): HistoryEntry[] {
  const list = loadHistory().filter((e) => e.id !== id);
  saveHistory(list);
  return list;
}

export async function rebuildThumbnails(): Promise<void> {
  const list = loadHistory().filter((e) => !e.thumbnail);
  for (const e of list) {
    const blob = await getBlob(e.id);
    if (!blob) continue;
    try {
      e.thumbnail = await blobToDataUrl(blob);
    } catch {
      /* ignore */
    }
  }
  saveHistory(list);
}

export const HISTORY_KEYS = { META_KEY, FAV_KEY, STORE };
