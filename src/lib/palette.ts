// Dominant color extraction via simple k-means on a downscaled canvas.

export type Swatch = { hex: string; rgb: [number, number, number]; share: number };

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function distSq(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export async function extractPalette(blob: Blob, k = 5): Promise<Swatch[]> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const scale = 64;
  const ratio = Math.min(1, scale / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const samples: Array<[number, number, number]> = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (samples.length === 0) return [];

  // k-means init — random distinct seeds
  const centroids: Array<[number, number, number]> = [];
  while (centroids.length < k) {
    const seed = samples[Math.floor(Math.random() * samples.length)];
    if (!centroids.some((c) => distSq(c, seed) < 4)) centroids.push([...seed] as [number, number, number]);
  }

  const labels = new Int32Array(samples.length);
  for (let iter = 0; iter < 12; iter++) {
    // assign
    let moved = false;
    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(samples[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    }
    // recompute
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const s = sums[labels[i]];
      s[0] += samples[i][0];
      s[1] += samples[i][1];
      s[2] += samples[i][2];
      s[3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        const nr = sums[c][0] / sums[c][3];
        const ng = sums[c][1] / sums[c][3];
        const nb = sums[c][2] / sums[c][3];
        const before = centroids[c];
        centroids[c] = [nr, ng, nb];
        if (distSq(before, centroids[c]) > 1) moved = true;
      }
    }
    if (!moved) break;
  }

  // Collapse near-duplicates & sort by share
  const counts = new Array(centroids.length).fill(0);
  for (let i = 0; i < samples.length; i++) counts[labels[i]]++;

  const seen: Swatch[] = [];
  centroids.forEach((c, idx) => {
    const [r, g, b] = c.map((v) => Math.round(v)) as [number, number, number];
    if (seen.some((s) => distSq(s.rgb, [r, g, b]) < 64)) return;
    seen.push({ hex: rgbToHex(r, g, b), rgb: [r, g, b], share: counts[idx] / samples.length });
  });

  return seen.sort((a, b) => b.share - a.share).slice(0, k);
}
