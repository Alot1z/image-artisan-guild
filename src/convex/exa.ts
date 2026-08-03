// Exa Semantic Registry — a Convex action that fronts the Exa search API.
//
// Exa (exa.ai) is a semantic web search engine: it returns the most relevant,
// up-to-date pages for a natural-language query, with per-result highlights and
// citations. The Inquisitor uses it as the "Semantic Registry" — a text-based
// companion to the visual engines. OCR text lifted from a plate (or the user's
// caption / notes) becomes a query, and Exa surfaces pages on the live web that
// discuss or describe the same subject.
//
// The API key lives ONLY on the server: read here from process.env.EXA_API_KEY.
// Set it in the Freebuff Keys tab (env var name: EXA_API_KEY). The key is never
// exposed to the client — the browser only ever calls this action.

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const EXA_BASE_URL = "https://api.exa.ai";

export interface ExaHit {
  id: number;
  title: string;
  url: string;
  publishedDate?: string;
  highlights: string[];
  score?: number;
  favicon?: string;
  image?: string;
}

export type ExaSearchResult =
  | { ok: true; query: string; searchedAt: number; hits: ExaHit[] }
  | { ok: false; error: "missing-key" | "http-error" | "rate-limited"; status?: number; hits: [] };

/**
 * Semantic web search via Exa. The query can be OCR text, a caption, a filename,
 * or any free-form phrase the archivist wants to chase across the live web.
 */
export const exaSearch = action({
  args: {
    query: v.string(),
    numResults: v.optional(v.number()),
    category: v.optional(v.string()),
    includeHighlights: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ExaSearchResult> => {
    const key = process.env.EXA_API_KEY;
    if (!key) {
      return { ok: false, error: "missing-key", hits: [] };
    }

    const query = args.query.trim();
    if (!query) {
      return { ok: false, error: "http-error", status: 400, hits: [] };
    }

    const numResults = Math.min(Math.max(args.numResults ?? 8, 1), 20);

    let res: Response;
    try {
      res = await fetch(`${EXA_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults,
          category: args.category || undefined,
          contents: {
            text: false,
            highlights: args.includeHighlights ?? true,
          },
        }),
      });
    } catch (err) {
      console.error("[exa] network failure", err);
      return { ok: false, error: "http-error", hits: [] };
    }

    if (res.status === 429) {
      return { ok: false, error: "rate-limited", status: 429, hits: [] };
    }
    if (!res.ok) {
      console.error("[exa] non-200 response", res.status);
      return { ok: false, error: "http-error", status: res.status, hits: [] };
    }

    let payload: { results?: Array<Record<string, unknown>> };
    try {
      payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
    } catch (err) {
      console.error("[exa] bad json", err);
      return { ok: false, error: "http-error", hits: [] };
    }

    const hits: ExaHit[] = (payload.results ?? []).slice(0, numResults).map((r, i) => ({
      id: i,
      title: typeof r.title === "string" && r.title ? r.title : "Untitled page",
      url: typeof r.url === "string" ? r.url : "",
      publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : undefined,
      highlights: Array.isArray(r.highlights) ? r.highlights.filter((h): h is string => typeof h === "string") : [],
      score: typeof r.score === "number" ? r.score : undefined,
      favicon: typeof r.favicon === "string" ? r.favicon : undefined,
      image: typeof r.image === "string" ? r.image : undefined,
    }));

    return { ok: true, query, searchedAt: Date.now(), hits };
  },
});
