// Self-Hosted Web Census — a Convex action that fans out to multiple free,
// publicly available web indexes in parallel, normalizes the results, and
// returns a merged, deduplicated, weighted ranking back to the Inquisitor's
// workbench. No paid third-party APIs, no API keys required.
//
// Sources queried (each with its own weighting):
//   • DuckDuckGo HTML  (live-web search via scraping, requires User-Agent)
//   • Wikipedia REST   (encyclopaedic citations)
//   • OpenAlex         (open scholarly catalog)
//   • Internet Archive (Wayback + TV news + radio transcripts)
//   • Open Library     (books & metadata)
//   • GitHub Code      (code references — anonymous, rate-limited)
//
// The action lives in a "use node" Convex function so it can use cheerio
// (server-side HTML parsing). fetch() with abort timeouts keeps things
// bounded if any source is slow.

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import * as cheerio from "cheerio";
import type { RegistryHit } from "./exa";

/** Common headers every outbound request uses — makes our traffic look like
 *  a regular desktop browser so we're not pre-blocked. */
const UA_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 6500;

async function fetchJson(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise away trackers, fragments and trailing slashes so the same URL
 *  coming from several sources dedupes to a single canonical key. */
function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Drop common GA / campaign params
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    drop.forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

interface RawHit {
  title: string;
  url: string;
  snippet?: string;
  score?: number;
  weight: number;
  origin: NonNullable<RegistryHit["origin"]>;
}

/** DuckDuckGo HTML search (the no-JS endpoint). Parsed with cheerio. */
async function fetchDdg(query: string, max: number): Promise<RawHit[]> {
  const html = await fetchHtml(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!html) return [];
  const $ = cheerio.load(html);
  const hits: RawHit[] = [];
  $("a.result__a").each((i, el) => {
    if (hits.length >= max) return;
    const title = $(el).text().trim();
    const href = $(el).attr("href") ?? "";
    // DDG HTML wraps the URL in a redirector (/l/?uddg=…). Fall back to that param.
    let url = href;
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch { /* ignore */ }
    const $snippet = $(el).closest(".result").find(".result__snippet").text().trim();
    if (title && url) hits.push({
      title,
      url,
      snippet: $snippet || undefined,
      weight: 1.0,
      origin: "duckduckgo",
    });
  });
  return hits;
}

/** Wikipedia REST search — open, no key, returns ordered relevance. */
async function fetchWikipedia(query: string, max: number): Promise<RawHit[]> {
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=${max}&srsearch=${encodeURIComponent(query)}&format=json&origin=*`,
  ) as { query?: { search?: Array<{ title: string; snippet: string }> } } | null;
  if (!data?.query?.search) return [];
  return data.query.search.map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: r.snippet.replace(/<[^>]+>/g, ""),
    weight: 1.25,
    origin: "wikipedia" as const,
  }));
}

/** OpenAlex works search — open scholarly catalog. */
async function fetchOpenAlex(query: string, max: number): Promise<RawHit[]> {
  const data = await fetchJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${max}`,
  ) as { results?: Array<{ title?: string; display_name?: string; publication_year?: number; doi?: string; id?: string }> } | null;
  if (!data?.results) return [];
  return data.results.map((r) => {
    const title = r.title ?? r.display_name ?? "Untitled work";
    const url = r.doi ? `https://doi.org/${r.doi}` : (r.id ? `https://openalex.org/${r.id}` : "");
    return {
      title,
      url,
      snippet: r.publication_year ? `Published ${r.publication_year}` : undefined,
      score: 1,
      weight: 1.15,
      origin: "openalex" as const,
    };
  }).filter((r) => r.url);
}

/** Internet Archive advanced-search endpoint (archives, web, video, audio). */
async function fetchArchive(query: string, max: number): Promise<RawHit[]> {
  const data = await fetchJson(
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,description,year&sort[]=score+desc&rows=${max}&output=json`,
  ) as { response?: { docs?: Array<{ identifier: string; title?: string; description?: string; year?: number }> } } | null;
  if (!data?.response?.docs) return [];
  return data.response.docs.map((r) => ({
    title: r.title ?? r.identifier,
    url: `https://archive.org/details/${r.identifier}`,
    snippet: [r.description?.replace(/<[^>]+>/g, ""), r.year ? `Anno ${r.year}` : ""].filter(Boolean).join(" · ") || undefined,
    weight: 1.05,
    origin: "archive" as const,
  }));
}

/** Open Library book search. */
async function fetchOpenLibrary(query: string, max: number): Promise<RawHit[]> {
  const data = await fetchJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${max}`,
  ) as { docs?: Array<{ title?: string; author_name?: string[]; first_publish_year?: number; key?: string }> } | null;
  if (!data?.docs) return [];
  return data.docs.map((r) => ({
    title: r.title ?? "Untitled",
    url: r.key ? `https://openlibrary.org${r.key}` : "",
    snippet: [r.author_name?.[0] && `by ${r.author_name[0]}`, r.first_publish_year && `first published ${r.first_publish_year}`].filter(Boolean).join(" — ") || undefined,
    weight: 0.85,
    origin: "openlibrary" as const,
  })).filter((r) => r.url);
}

/** GitHub Code Search — anonymous quota is 60 req/hour. */
async function fetchGitHub(query: string, max: number): Promise<RawHit[]> {
  const data = await fetchJson(
    `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${Math.min(max, 5)}`,
    // We add a GitHub-specific Accept header for code search results.
  ) as { items?: Array<{ name: string; path: string; html_url: string; repository: { full_name: string } }> } | null;
  if (!data?.items) return [];
  return data.items.map((r) => ({
    title: `${r.repository.full_name} — ${r.path}`,
    url: r.html_url,
    snippet: `Code reference · ${r.name}`,
    weight: 0.7,
    origin: "github" as const,
  }));
}

export type CensusResult =
  | { ok: true; query: string; searchedAt: number; hits: RegistryHit[]; sources: Record<string, number> }
  | { ok: false; error: "empty-query" | "no-results"; hits: []; sources: Record<string, number> };

/** Fan out to all six sources in parallel, merge, dedupe, rank. */
export const webCensus = action({
  args: {
    query: v.string(),
    numResults: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CensusResult> => {
    const query = args.query.trim();
    if (!query) return { ok: false, error: "empty-query", hits: [], sources: {} };
    const max = Math.min(Math.max(args.numResults ?? 12, 1), 24);

    const perSourceBudget = Math.max(4, Math.ceil(max / 2));

    const settled = await Promise.allSettled([
      fetchDdg(query, perSourceBudget),
      fetchWikipedia(query, perSourceBudget),
      fetchOpenAlex(query, perSourceBudget),
      fetchArchive(query, perSourceBudget),
      fetchOpenLibrary(query, perSourceBudget),
      fetchGitHub(query, perSourceBudget),
    ]);

    const sources: Record<string, number> = {};
    const merged: RawHit[] = [];
    const harvest = (idx: number, name: string, value: PromiseSettledResult<RawHit[]>) => {
      if (value.status === "fulfilled" && value.value.length > 0) {
        sources[name] = value.value.length;
        merged.push(...value.value);
      } else {
        sources[name] = 0;
      }
    };
    harvest(0, "duckduckgo", settled[0]);
    harvest(1, "wikipedia", settled[1]);
    harvest(2, "openalex", settled[2]);
    harvest(3, "archive", settled[3]);
    harvest(4, "openlibrary", settled[4]);
    harvest(5, "github", settled[5]);

    if (merged.length === 0) {
      return { ok: false, error: "no-results", hits: [], sources };
    }

    // Dedupe by canonicalised URL; the FIRST that touches a key wins, and we
    // remember every additional source that mentioned the same URL so we can
    // boost the merged score (multi-source consensus = stronger).
    interface DedupBucket { hit: RawHit; support: number; }
    const buckets = new Map<string, DedupBucket>();
    for (const h of merged) {
      const key = canonicalize(h.url);
      const existing = buckets.get(key);
      if (existing) {
        existing.support += 1;
        existing.hit.weight = Math.max(existing.hit.weight, h.weight) + 0.15 * existing.support;
      } else {
        buckets.set(key, { hit: h, support: 1 });
      }
    }

    const ranked = Array.from(buckets.values())
      .map((b) => ({
        ...b.hit,
        weight: b.hit.weight + 0.15 * b.support,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, max);

    const hits: RegistryHit[] = ranked.map((r, i) => ({
      id: i,
      title: r.title,
      url: r.url,
      source: "census",
      origin: r.origin,
      snippet: r.snippet,
      score: r.score,
      weight: Number(r.weight.toFixed(3)),
      publishedDate: undefined,
    }));

    return { ok: true, query, searchedAt: Date.now(), hits, sources };
  },
});
