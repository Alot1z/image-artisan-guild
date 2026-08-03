// Registry of reverse image search engines. Each engine describes how the app
// submits an image to it: either by uploading the file directly to the engine's
// own form endpoint, or by opening the engine with a hosted URL we control.

export type EngineMode = "form-upload" | "url-open";

export interface Engine {
  id: string;
  name: string;
  description: string;
  category: "general" | "stock" | "art" | "anime" | "shopping" | "geolocation";
  mode: EngineMode;
  /** For form-upload engines: hidden form action URL and field name. */
  upload?: { endpoint: string; fieldName: string };
  /** For url-open engines: function that produces the engine's search URL from a hosted image URL. */
  urlBuilder?: (imageUrl: string) => string;
  /** Built-in logo/initials rendered in the UI when no remote icon is available. */
  mark: string;
}

export const ENGINES: Engine[] = [
  {
    id: "google-lens",
    name: "Google Lens",
    description: "General visual search across the public web.",
    category: "general",
    mode: "form-upload",
    upload: { endpoint: "https://lens.google.com/upload", fieldName: "encoded_image" },
    mark: "G",
  },
  {
    id: "tineye",
    name: "TinEye",
    description: "Reverse image traceback — finds every known copy.",
    category: "general",
    mode: "form-upload",
    upload: { endpoint: "https://tineye.com/search", fieldName: "image" },
    mark: "T",
  },
  {
    id: "bing",
    name: "Bing Visual",
    description: "Microsoft's visual search with shopping results.",
    category: "shopping",
    mode: "url-open",
    urlBuilder: (url) => `https://www.bing.com/images/search?view=detailv2&iss=sbiupload&form=ANCMS1&imgurl=${encodeURIComponent(url)}&exph=0&expw=0&q=imgurl:${encodeURIComponent(url)}&vt=2`,
    mark: "B",
  },
  {
    id: "yandex",
    name: "Yandex Images",
    description: "Russia's deepest visual catalogue — strong on faces.",
    category: "general",
    mode: "url-open",
    urlBuilder: (url) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
    mark: "Y",
  },
  {
    id: "lenso",
    name: "Lenso.ai",
    description: "AI-driven similar-image search across portfolios.",
    category: "art",
    mode: "url-open",
    urlBuilder: (url) => `https://lenso.ai/?url=${encodeURIComponent(url)}`,
    mark: "L",
  },
  {
    id: "saucenao",
    name: "SauceNAO",
    description: "Anime & illustration source finder.",
    category: "anime",
    mode: "form-upload",
    upload: { endpoint: "https://saucenao.com/search.php", fieldName: "image" },
    mark: "S",
  },
  {
    id: "baidu",
    name: "Baidu Images",
    description: "China's largest visual search index.",
    category: "general",
    mode: "url-open",
    urlBuilder: (url) => `https://image.baidu.com/pcdown?queryImageUrl=${encodeURIComponent(url)}`,
    mark: "百",
  },
  {
    id: "trace",
    name: "ImageSearch",
    description: "Aggregated visual search & similar-image finder.",
    category: "stock",
    mode: "form-upload",
    upload: { endpoint: "https://images.google.com/searchbyimage?image_url=" /* not used; opens new window below */ , fieldName: "image" },
    mark: "I",
  },
];

export function engineById(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** Build a temporary hidden form that uploads an image blob to a search engine
 *  and navigates the current tab to the result page. */
export function dispatchByForm(engine: Engine, blob: Blob): HTMLFormElement {
  const form = document.createElement("form");
  form.method = "POST";
  form.enctype = "multipart/form-data";
  form.action = engine.upload!.endpoint;
  form.target = engine.id === "tineye" ? "_blank" : "_self";
  form.style.display = "none";

  const file = new File([blob], "inquiry.jpg", { type: blob.type || "image/jpeg" });
  const input = document.createElement("input");
  input.type = "file";
  input.name = engine.upload!.fieldName;
  // Some engines (SauceNAO) need the file in the multipart body.
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  form.appendChild(input);

  if (engine.id === "tineye") {
    const sort = document.createElement("input");
    sort.name = "sort"; sort.value = "score"; form.appendChild(sort);
    const order = document.createElement("input");
    order.name = "order"; order.value = "desc"; form.appendChild(order);
  }
  if (engine.id === "saucenao") {
    const frame = document.createElement("input");
    frame.name = "frame"; frame.value = "1"; form.appendChild(frame);
    const hide = document.createElement("input");
    hide.name = "hide"; hide.value = "0"; form.appendChild(hide);
  }
  document.body.appendChild(form);
  return form;
}

export function openByUrl(engine: Engine, imageUrl: string): void {
  const target = engine.urlBuilder ? engine.urlBuilder(imageUrl) : "";
  if (!target) return;
  window.open(target, "_blank", "noopener,noreferrer");
}
