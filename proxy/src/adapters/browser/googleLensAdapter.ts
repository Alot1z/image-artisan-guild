import { proxyConfig } from "../../core/config.js";
import type {
  EngineCapability,
  NormalizedResult,
  RawSearchResult,
} from "../base.js";
import { asConfidence, asString, result, safeUrl } from "../base.js";
import {
  BaseBrowserAdapter,
  type BrowserAdapterOptions,
  type BrowserPageLike,
} from "./baseBrowserAdapter.js";

export class BrowserBlockedError extends Error {
  constructor(adapterId: string) {
    super(`Automated request was blocked for adapter ${adapterId}`);
    this.name = "BrowserBlockedError";
  }
}

const LENS_HOSTS = new Set([
  "lens.google.com",
  "www.google.com",
  "google.com",
  "consent.google.com",
  "accounts.google.com",
  "support.google.com",
]);

/** Unwrap Google's /url?q= redirector used on results pages. */
export function unwrapGoogleUrl(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (url.hostname === "www.google.com" && url.pathname === "/url") {
      const target = url.searchParams.get("q");
      if (target) return unwrapGoogleUrl(target) ?? safeUrl(target);
      return undefined;
    }
    return safeUrl(href);
  } catch {
    return undefined;
  }
}

/** Heuristic signals that Google served a block/consent page instead of results. */
export function looksBlocked(content: string): boolean {
  const signals = [
    "unusual traffic",
    "captcha",
    "recaptcha",
    "not a robot",
    "enablejs",
    "temporarily blocked",
    "automated requests",
  ];
  const lower = content.toLowerCase();
  return signals.some((signal) => lower.includes(signal));
}

export interface LensScrapedTile {
  href: string | null;
  text: string;
  title: string | null;
  imgSrc: string | null;
  imgWidth: string | null;
  imgHeight: string | null;
  position: number;
}

interface GoogleLensAdapterOptions extends BrowserAdapterOptions {
  uploadUrl?: string;
  resultsTimeoutMs?: number;
  settleDelayMs?: number;
  maxResults?: number;
}

export class GoogleLensAdapter extends BaseBrowserAdapter {
  readonly id = "google-lens";
  readonly name = "Google Lens";
  readonly capabilities: EngineCapability = {
    supportsImageUpload: false,
    supportsUrlInput: true,
    requiresAuth: false,
    integrationType: "playwright",
  };

  private readonly uploadUrl: string;
  private readonly resultsTimeoutMs: number;
  private readonly settleDelayMs: number;
  private readonly maxResults: number;

  constructor(options: GoogleLensAdapterOptions = {}) {
    super(options);
    this.uploadUrl = options.uploadUrl ?? proxyConfig.lensUploadUrl;
    this.resultsTimeoutMs = options.resultsTimeoutMs ?? proxyConfig.lensResultsTimeoutMs;
    this.settleDelayMs = options.settleDelayMs ?? 1_500;
    this.maxResults = options.maxResults ?? 100;
  }

  async execute(imageUrl: string): Promise<RawSearchResult[]> {
    const page = await this.openPage();
    try {
      const target = `${this.uploadUrl}?url=${encodeURIComponent(imageUrl)}`;
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs });

      try {
        await page.waitForSelector("a[href]", { timeout: this.resultsTimeoutMs, state: "visible" });
      } catch {
        const content = await page.content();
        if (looksBlocked(content)) throw new BrowserBlockedError(this.id);
        // Page loaded but produced no result links — an honest empty search.
        return [];
      }

      if (this.settleDelayMs > 0) await page.waitForTimeout(this.settleDelayMs);
      const tiles = await this.scrapeTiles(page);
      return this.buildRaw(tiles);
    } finally {
      await page.close();
    }
  }

  private async scrapeTiles(page: BrowserPageLike): Promise<LensScrapedTile[]> {
    return page.locator("a[href]").evaluateAll<LensScrapedTile[]>((els) =>
      els.slice(0, 250).map((el, index) => {
        const img = el.querySelector("img");
        return {
          href: el.getAttribute("href"),
          text: (el.textContent ?? "").trim().slice(0, 240),
          title: el.getAttribute("title"),
          imgSrc: img ? img.getAttribute("src") ?? img.getAttribute("data-src") : null,
          imgWidth: img ? img.getAttribute("width") : null,
          imgHeight: img ? img.getAttribute("height") : null,
          position: index,
        };
      }),
    );
  }

  /** Pure DOM-parse step: filters chrome links, dedupes, and shapes raw results. */
  buildRaw(tiles: LensScrapedTile[]): RawSearchResult[] {
    const seen = new Set<string>();
    const raw: RawSearchResult[] = [];
    for (const tile of tiles) {
      const url = tile.href ? unwrapGoogleUrl(tile.href) : undefined;
      if (!url) continue;
      let host = "";
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      if (LENS_HOSTS.has(host)) continue;
      const key = url.replace(/[?#].*$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const thumbnail = safeUrl(tile.imgSrc) ?? undefined;
      const dimensions =
        [asString(tile.imgWidth, 8), asString(tile.imgHeight, 8)].filter(Boolean).join("x") || undefined;
      raw.push({
        url,
        title: tile.title ?? (tile.text || undefined),
        ...(thumbnail ? { thumbnail } : {}),
        ...(dimensions ? { dimensions } : {}),
        position: tile.position,
      });
    }
    return raw.slice(0, this.maxResults);
  }

  normalize(raw: RawSearchResult[]): NormalizedResult[] {
    return raw.flatMap((item) => {
      const url = safeUrl(item.url);
      if (!url) return [];
      const position = typeof item.position === "number" ? item.position : 0;
      const confidence = asConfidence(Math.max(0.05, 0.9 - position * 0.05));
      const thumbnail = safeUrl(item.thumbnail) ?? undefined;
      const title = asString(item.title) ?? "Google Lens match";
      const dimensions = asString(item.dimensions, 32);
      return [result(this.id, url, { thumbnail, confidence, title, dimensions })];
    });
  }
}
