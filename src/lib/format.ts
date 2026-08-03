// Image format conversion — JPEG, PNG, WebP with user-chosen quality.
// Returns a new Blob in the selected format plus a before/after byte report.
import { humanSize } from "@/lib/image-utils";

export type TargetFormat = "image/jpeg" | "image/png" | "image/webp";

export interface Converted {
  blob: Blob;
  mime: TargetFormat;
  before: number;
  after: number;
  ratio: number;    // after / before
  label: string;    // e.g. "384 KB → 162 KB (WebP, q=0.82)"
}

export async function convertFormat(
  source: Blob,
  target: TargetFormat,
  quality = 0.85,
): Promise<Converted> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? new Blob()), target, quality);
  });

  const before = source.size;
  const after = blob.size;
  const ext = target.split("/")[1].toUpperCase();
  const beforeH = humanSize(before);
  const afterH = humanSize(after);

  return {
    blob,
    mime: target,
    before,
    after,
    ratio: after / before,
    label: `${beforeH} → ${afterH} (${ext}, q=${quality.toFixed(2)})`,
  };
}

export async function convertAndDownload(
  source: Blob,
  target: TargetFormat,
  filenameStem: string,
  quality = 0.85,
) {
  const result = await convertFormat(source, target, quality);
  const url = URL.createObjectURL(result.blob);
  const ext = target.split("/")[1];
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return result;
}
