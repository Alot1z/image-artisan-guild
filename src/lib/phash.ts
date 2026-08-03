// Average-hash perceptual fingerprint for image similarity detection.
// Pure JS — uses an offscreen canvas to downscale to 8x8 grayscale and
// generate a 64-bit hash that can be compared with Hamming distance.

export async function perceptualHash(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    // ITU-R BT.601 luma
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  const avg = gray.reduce((s, v) => s + v, 0) / gray.length;
  let hash = "";
  for (let i = 0; i < gray.length; i++) {
    hash += gray[i] >= avg ? "1" : "0";
  }
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function similarityPercent(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = hammingDistance(a, b);
  return Math.round((1 - dist / a.length) * 100);
}
