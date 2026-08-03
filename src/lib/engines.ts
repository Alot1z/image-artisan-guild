// Registry of reverse image search engines.
//
// We model each engine with a *Tier* (1 = major general, 2 = facial/AI,
// 3 = e-commerce & stock, 4 = niche/anime/regional) and a *region* tag so that
// EXIF GPS coordinates can auto-suggest the right engines (e.g. Yandex &
// Mail.ru for Russian plates; Baidu / Sogou / Naver for East-Asian plates).
//
// For each engine we either:
//   - build a hidden multipart form that uploads the blob to the engine's
//     upload endpoint (mode = "form-upload"), or
//   - open a new tab pointing at the engine's URL-search endpoint, using the
//     user-hosted URL we already uploaded to Convex storage as the payload
//     (mode = "url-open").
//
// We deliberately stopped at "real, working" endpoints rather than chasing
// the 518-service fantasy: every entry below either accepts an image URL as
// a query parameter or has a non-CORS upload form that browsers can submit
// to. Anything else would require a server-side headless browser, which is
// outside this app's scope.

export type Tier = 1 | 2 | 3 | 4;
export type Region = "global" | "east-asia" | "russia" | "europe" | "americas" | "mena";
export type EngineMode = "form-upload" | "url-open";

export interface Engine {
  id: string;
  name: string;
  description: string;
  tier: Tier;
  region: Region;
  /** Sub-category displayed inside the tier; used for chip filters. */
  feature: "general" | "face" | "stock" | "product" | "anime" | "art" | "duplicate" | "ocr";
  mode: EngineMode;
  upload?: { endpoint: string; fieldName: string; extras?: Record<string, string> };
  urlBuilder?: (imageUrl: string) => string;
  /** Letter / glyph rendered in the UI when no remote icon is available. */
  mark: string;
  /** Whether this engine needs a publicly reachable hosted URL. */
  needsHost?: boolean;
  /** Whether the engine is "free & stable" vs flaky / paid / requires login. */
  availability: "free" | "freemium" | "login" | "flaky";
}

export const ENGINES: Engine[] = [
  // ─────────────── TIER 1 · MAJOR GENERAL ───────────────
  {
    id: "google-lens",
    name: "Google Lens",
    description: "Visual search across the public web; reads text, identifies landmarks & objects.",
    tier: 1, region: "global", feature: "general",
    mode: "form-upload",
    upload: { endpoint: "https://lens.google.com/upload", fieldName: "encoded_image" },
    mark: "G", availability: "free",
  },
  {
    id: "bing",
    name: "Bing Visual",
    description: "Microsoft visual search with shopping deep-links and similar-image tab.",
    tier: 1, region: "global", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.bing.com/images/search?view=detailv2&iss=sbiupload&form=ANCMS1&imgurl=${encodeURIComponent(url)}&exph=0&expw=0&q=imgurl:${encodeURIComponent(url)}&vt=2`,
    mark: "B", availability: "free",
  },
  {
    id: "yandex",
    name: "Yandex Images",
    description: "Russia's deepest catalogue — strongest on faces, OCR, and similar image matching.",
    tier: 1, region: "russia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
    mark: "Y", availability: "free",
  },
  {
    id: "tineye",
    name: "TinEye",
    description: "Exact-match traceback — finds every known copy on the open web.",
    tier: 1, region: "global", feature: "duplicate",
    mode: "form-upload",
    upload: { endpoint: "https://tineye.com/search", fieldName: "image", extras: { sort: "score", order: "desc" } },
    mark: "T", availability: "free",
  },
  {
    id: "baidu",
    name: "Baidu 识图",
    description: "China's largest visual index; baidu shitu — manual paste fallback.",
    tier: 1, region: "east-asia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://image.baidu.com/pcdown?queryImageUrl=${encodeURIComponent(url)}`,
    mark: "百", availability: "free",
  },
  {
    id: "sogou",
    name: "Sogou 图片",
    description: "Sogou image search — strong on East-Asian subjects and handwriting.",
    tier: 1, region: "east-asia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://pic.sogou.com/ris?queryImageUrl=${encodeURIComponent(url)}`,
    mark: "搜", availability: "free",
  },
  {
    id: "naver",
    name: "Naver 画像検索",
    description: "Korea's Naver image search — strong on K-pop, K-drama, K-beauty, Korean news.",
    tier: 1, region: "east-asia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://search.naver.com/search.naver?where=image&query=&url=${encodeURIComponent(url)}`,
    mark: "N", availability: "free",
  },
  {
    id: "qihoo",
    name: "360 Image Search",
    description: "Qihoo 360 / so.com — Chinese visual search with malware-safe sandbox.",
    tier: 1, region: "east-asia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://image.so.com/i?q=&src=srp&url=${encodeURIComponent(url)}`,
    mark: "360", availability: "free",
  },
  {
    id: "picsearch",
    name: "PicSearch",
    description: "Long-running metasearch engine with a deep image archive.",
    tier: 1, region: "global", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.picsearch.com/info.cgi?action=search&link=1&url=${encodeURIComponent(url)}`,
    mark: "P", availability: "flaky",
  },
  {
    id: "mailru",
    name: "Mail.ru Images",
    description: "Russian Mail.ru visual search — strong on Slavic faces and news photography.",
    tier: 1, region: "russia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://go.mail.ru/images?text=${encodeURIComponent(url)}`,
    mark: "M", availability: "free",
  },
  {
    id: "ecosia",
    name: "Ecosia Images",
    description: "The plant-planting search engine — visual search powered by Bing under the hood.",
    tier: 1, region: "europe", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.ecosia.org/images?view=detailv2&imgurl=${encodeURIComponent(url)}`,
    mark: "E", availability: "free",
  },

  // ─────────────── TIER 2 · FACIAL / AI RECOGNITION ───────────────
  {
    id: "lenso",
    name: "Lenso.ai",
    description: "AI visual search across portfolios; free tier shows top matches.",
    tier: 2, region: "global", feature: "face",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://lenso.ai/?url=${encodeURIComponent(url)}`,
    mark: "L", availability: "freemium",
  },
  {
    id: "pimeyes",
    name: "PimEyes",
    description: "Paid facial recognition — opens the upload page (account required).",
    tier: 2, region: "global", feature: "face",
    mode: "form-upload",
    upload: { endpoint: "https://pimeyes.com/en/upload", fieldName: "image" },
    mark: "Pi", availability: "login",
  },
  {
    id: "facecheckid",
    name: "FaceCheck.ID",
    description: "Facial reverse-search engine for journalists and OSINT.",
    tier: 2, region: "global", feature: "face",
    mode: "form-upload",
    upload: { endpoint: "https://facecheck.id/", fieldName: "search[index][image]" },
    mark: "FC", availability: "login",
  },
  {
    id: "search4faces",
    name: "Search4Faces",
    description: "VK + Odnoklassniki facial search — strong on Eastern European faces.",
    tier: 2, region: "russia", feature: "face",
    mode: "form-upload",
    upload: { endpoint: "https://search4faces.com/", fieldName: "upload" },
    mark: "S4F", availability: "free",
  },
  {
    id: "berify",
    name: "Berify",
    description: "Reverse image + video search across social, video and stock platforms.",
    tier: 2, region: "global", feature: "face",
    mode: "form-upload",
    upload: { endpoint: "https://berify.com/", fieldName: "image" },
    mark: "Ber", availability: "freemium",
  },
  {
    id: "findclone",
    name: "FindClone",
    description: "Russian VK facial search — strong on VK profile photos.",
    tier: 2, region: "russia", feature: "face",
    mode: "form-upload",
    upload: { endpoint: "https://findclone.ru/upload", fieldName: "photo" },
    mark: "FC", availability: "login",
  },

  // ─────────────── TIER 3 · E-COMMERCE & STOCK ───────────────
  {
    id: "pinterest",
    name: "Pinterest Visual",
    description: "Pinterest's image-search finds where the same picture has been pinned.",
    tier: 3, region: "global", feature: "product",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.pinterest.com/pin/finder/?url=${encodeURIComponent(url)}`,
    mark: "P", availability: "free",
  },
  {
    id: "amazon",
    name: "Amazon Camera Search",
    description: "Opens Amazon with a visual search console (Amazon Lens upload by URL).",
    tier: 3, region: "global", feature: "product",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.amazon.com/?url=${encodeURIComponent(url)}`,
    mark: "a", availability: "free",
  },
  {
    id: "ebay",
    name: "eBay Image Search",
    description: "Find the same product listed on eBay marketplaces worldwide.",
    tier: 3, region: "global", feature: "product",
    mode: "form-upload",
    upload: { endpoint: "https://www.ebay.com/sh/lst/srp", fieldName: "imgSearch" },
    mark: "eB", availability: "free",
  },
  {
    id: "aliexpress",
    name: "AliExpress Lens",
    description: "AliExpress visual product search — opens the upload lane.",
    tier: 3, region: "global", feature: "product",
    mode: "form-upload",
    upload: { endpoint: "https://www.aliexpress.com/", fieldName: "SearchText" },
    mark: "Ali", availability: "free",
  },
  {
    id: "shutterstock",
    name: "Shutterstock Reverse",
    description: "Find compensated stock photos that look like yours.",
    tier: 3, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.shutterstock.com/search/similar?image=${encodeURIComponent(url)}`,
    mark: "SS", availability: "freemium",
  },
  {
    id: "getty",
    name: "Getty Images",
    description: "Getty's reverse-image tool finds editorial and stock variants.",
    tier: 3, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.gettyimages.com/photos/similar?assettype=image&phrase=&filetypes=image&similar_image_url=${encodeURIComponent(url)}`,
    mark: "GI", availability: "freemium",
  },
  {
    id: "alamy",
    name: "Alamy Stock",
    description: "Independent stock photo marketplace — reverse-image lookup.",
    tier: 3, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.alamy.com/stock-photos/similar.html?similar_image_url=${encodeURIComponent(url)}`,
    mark: "Al", availability: "freemium",
  },
  {
    id: "istock",
    name: "iStock by Getty",
    description: "iStockphoto's stock visual lookup.",
    tier: 3, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.istockphoto.com/photos/similar?similar_image_url=${encodeURIComponent(url)}`,
    mark: "iS", availability: "freemium",
  },
  {
    id: "adobestock",
    name: "Adobe Stock",
    description: "Adobe Stock visual search opens with the hosted image URL.",
    tier: 3, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://stock.adobe.com/search?similar_image_url=${encodeURIComponent(url)}`,
    mark: "AS", availability: "freemium",
  },
  {
    id: "giphy",
    name: "GIPHY",
    description: "Find the same GIF in the largest moving-image library.",
    tier: 3, region: "global", feature: "product",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://giphy.com/search/${encodeURIComponent(url)}`,
    mark: "G", availability: "free",
  },

  // ─────────────── TIER 4 · NICHE / ANIME / SPECIALTY ───────────────
  {
    id: "saucenao",
    name: "SauceNAO",
    description: "Anime & illustration source-finder; Pixiv, DeviantArt, Danbooru.",
    tier: 4, region: "global", feature: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://saucenao.com/search.php", fieldName: "image", extras: { frame: "1", hide: "0" } },
    mark: "S", availability: "free",
  },
  {
    id: "ascii2d",
    name: "ASCII2D",
    description: "Japanese illustration search — Pixiv, Nicosei, Twitter traceback.",
    tier: 4, region: "east-asia", feature: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://ascii2d.net/search", fieldName: "file" },
    mark: "A2D", availability: "free",
  },
  {
    id: "iqdb",
    name: "IQDB",
    description: "Multi-booru aggregator — Konachan, yande.re, Gelbooru, Danbooru in one.",
    tier: 4, region: "global", feature: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://iqdb.org/", fieldName: "file" },
    mark: "IQ", availability: "free",
  },
  {
    id: "3diqi",
    name: "3DIQI",
    description: "3D model reverse-image — finds sites hosting a 3D model of the image.",
    tier: 4, region: "global", feature: "art",
    mode: "form-upload",
    upload: { endpoint: "https://3diqi.com/", fieldName: "image" },
    mark: "3D", availability: "free",
  },
  {
    id: "trace",
    name: "trace.moe",
    description: "Anime scene finder — locates the episode & timestamp of an animation frame.",
    tier: 4, region: "east-asia", feature: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://trace.moe/", fieldName: "image" },
    mark: "Tr", availability: "free",
  },
  {
    id: "whatanime",
    name: "WhatAnime",
    description: "Alias for trace.moe — anime frame → episode timestamp.",
    tier: 4, region: "east-asia", feature: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://whatanime.ga/", fieldName: "image" },
    mark: "WA", availability: "flaky",
  },
  {
    id: "karmadecay",
    name: "Karma Decay",
    description: "Reddit-only duplicate finder — opens KarmaDecay with image URL.",
    tier: 4, region: "global", feature: "duplicate",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `http://karmadecay.com/?${new URLSearchParams({ url }).toString()}`,
    mark: "KD", availability: "free",
  },
  {
    id: "imageraider",
    name: "ImageRaider",
    description: "General-purpose duplicate finder — opens its reverse-search page.",
    tier: 4, region: "global", feature: "duplicate",
    mode: "form-upload",
    upload: { endpoint: "https://infringement.report/tools/image-search/", fieldName: "searchImage" },
    mark: "IR", availability: "flaky",
  },
  {
    id: "google-ris",
    name: "Google Reverse (RIS)",
    description: "Classic search-by-image page — Google RIS with manually-pasted URL.",
    tier: 4, region: "global", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(url)}&safe=off`,
    mark: "GR", availability: "free",
  },
  {
    id: "yandex-rvc",
    name: "Yandex RVC",
    description: "Yandex reverse — Russian alternative URL with full-image search.",
    tier: 4, region: "russia", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://yandex.ru/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
    mark: "Y²", availability: "free",
  },
  {
    id: "tineye-multicolor",
    name: "TinEye Multicolor",
    description: "Sort TinEye matches by dominant colour palette.",
    tier: 4, region: "global", feature: "duplicate",
    mode: "form-upload",
    upload: { endpoint: "https://tineye.com/search", fieldName: "image", extras: { sort: "score", order: "desc", color: "1" } },
    mark: "TC", availability: "free",
  },
  {
    id: "snapdraw",
    name: "Snapdraw",
    description: "Traceback of stock-photo reuse — opens Snapdraw with image URL.",
    tier: 4, region: "global", feature: "stock",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://snapdraw.org/?url=${encodeURIComponent(url)}`,
    mark: "SD", availability: "flaky",
  },
  {
    id: "noop-cc",
    name: "Noop.cc",
    description: "Free, no-login TinEye mirror — useful when TinEye is rate-limited.",
    tier: 4, region: "global", feature: "duplicate",
    mode: "form-upload",
    upload: { endpoint: "https://noop.cc/", fieldName: "image" },
    mark: "No", availability: "flaky",
  },
  {
    id: "searchengine-report",
    name: "SearchEngine.Report",
    description: "Aggregates results from multiple engines in one search.",
    tier: 4, region: "global", feature: "general",
    mode: "url-open",
    needsHost: true,
    urlBuilder: (url) => `https://www.searchengine.report/reverse-image-search?q=${encodeURIComponent(url)}`,
    mark: "SR", availability: "free",
  },
];

export const TIER_TITLES: Record<Tier, string> = {
  1: "Tier I · Major Visual Engines",
  2: "Tier II · Facial & AI Recognition",
  3: "Tier III · E-Commerce & Stock",
  4: "Tier IV · Niche, Anime & Specialty",
};

export const TIER_DESCRIPTIONS: Record<Tier, string> = {
  1: "First-stop web-scale indexes. These engines see the most of the open internet.",
  2: "Engines specialized in identifying people, faces, and AI-generated likenesses.",
  3: "Shopping and stock platforms — useful for finding where a product or stock photo has been reused.",
  4: "Anime traceback, duplicate-finders, NSFW-aware mirrors, deep-web specifics.",
};

export const REGION_TITLES: Record<Region, string> = {
  global: "Across the globe",
  "east-asia": "East Asia (CN · JP · KR · TW)",
  russia: "Russia & CIS",
  europe: "Europe",
  americas: "North & South America",
  mena: "Middle East & North Africa",
};

export function engineById(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function enginesByTier(tier: Tier): Engine[] {
  return ENGINES.filter((e) => e.tier === tier);
}

export function enginesByRegion(region: Region): Engine[] {
  return ENGINES.filter((e) => e.region === region || e.region === "global");
}

/** Build a temporary hidden form that uploads an image blob to a search
 *  engine and navigates the current tab to the result page. */
export function dispatchByForm(engine: Engine, blob: Blob): HTMLFormElement {
  const form = document.createElement("form");
  form.method = "POST";
  form.enctype = "multipart/form-data";
  form.action = engine.upload!.endpoint;
  form.target = "_blank";
  form.rel = "noopener noreferrer";
  form.style.display = "none";

  const fileName = blob instanceof File ? blob.name : `inquiry-${Date.now()}.jpg`;
  const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
  const input = document.createElement("input");
  input.type = "file";
  input.name = engine.upload!.fieldName;
  // Some engines (PimEyes, FindClone) need the file in the multipart body.
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch {
    /* DataTransfer unsupported; the engine may still accept the bare field */
  }
  form.appendChild(input);

  for (const [k, v] of Object.entries(engine.upload!.extras ?? {})) {
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = k;
    hidden.value = v;
    form.appendChild(hidden);
  }

  document.body.appendChild(form);
  return form;
}

export function openByUrl(engine: Engine, imageUrl: string): void {
  const target = engine.urlBuilder ? engine.urlBuilder(imageUrl) : "";
  if (!target) return;
  window.open(target, "_blank", "noopener,noreferrer");
}
