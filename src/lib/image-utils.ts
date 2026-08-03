// Image utility helpers — resizing, conversion, filename analysis.

export interface ImageMeta {
  file: File | null;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  width: number;
  height: number;
  url: string;
}

export async function blobToMeta(blob: Blob, name = "inquiry.jpg"): Promise<ImageMeta> {
  const url = URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  const dataUrl = await blobToDataUrl(blob);
  return {
    file: blob instanceof File ? blob : null,
    blob,
    name: blob instanceof File ? blob.name : name,
    type: blob.type || "image/jpeg",
    size: blob.size,
    dataUrl,
    width: bitmap.width,
    height: bitmap.height,
    url,
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export async function downscale(blob: Blob, maxDim = 1600, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), "image/jpeg", quality);
  });
}

export interface ImageAttribution {
  bytes: string;
  resolution: string;
  aspect: string;
}

export function describe(image: { size: number; width: number; height: number }): ImageAttribution {
  const bytes = humanSize(image.size);
  const resolution = `${image.width} × ${image.height}`;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(image.width || 1, image.height || 1);
  const aspect = `${Math.round((image.width || 1) / g)}:${Math.round((image.height || 1) / g)}`;
  return { bytes, resolution, aspect };
}

export function humanSize(bytes: number): string {
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

export async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard || !window.ClipboardItem) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          return blob;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchImageFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
  return res.blob();
}
