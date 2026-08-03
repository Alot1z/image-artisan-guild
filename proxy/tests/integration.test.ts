import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mockUpstream } from "./setup.js";

// Values match tests/setup.ts (loaded via --preload) so the app singleton is
// built with the same credentials regardless of import order. These lines also
// let this file run standalone without the preload.
process.env.RIS_PROXY_KEY = "test-secret";
process.env.SAUCENAO_API_KEY = "test-saucenao-key";
process.env.BING_VISUAL_SEARCH_API_KEY = "test-bing-key";

// Register fixture payloads with the shared upstream dispatcher installed by
// tests/setup.ts (via --preload), so the real adapters execute against mocked
// HTTP regardless of app module construction order.
const sauceNaoPayload = {
  results: [
    {
      header: { similarity: "92.40", thumbnail: "https://img.example/thumb.jpg" },
      data: {
        ext_urls: ["not-a-url", "https://source.example/art/42"],
        title: "Archived plate",
        creator: "A. Archivist",
        width: 1200,
        height: 800,
      },
    },
    {
      header: { similarity: "61.2" },
      data: { source: "https://source.example/second", author: "Unknown" },
    },
  ],
};
const bingPayload = [
  {
    actionType: "VisualSearch",
    image: {
      name: "Shared match",
      // Deliberately duplicates SauceNAO's first hit to exercise deduplication.
      contentUrl: "https://source.example/art/42",
      thumbnailUrl: "https://img.example/thumb.jpg",
    },
  },
  {
    type: "PagesIncluding",
    value: {
      name: "Match page",
      contentUrl: "https://shared.example/photo.jpg",
      thumbnailUrl: "https://shared.example/thumb.jpg",
      hostPageUrl: "https://shared.example/page",
    },
  },
  {
    actionType: "VisualSearch",
    image: {
      name: "Bing-only",
      contentUrl: "https://bing.example/other.jpg",
      thumbnailUrl: "https://bing.example/thumb.jpg",
    },
  },
];

mockUpstream((url) => {
  if (url.startsWith("https://saucenao.com/")) {
    return new Response(JSON.stringify(sauceNaoPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("https://api.bing.microsoft.com/")) {
    return new Response(JSON.stringify(bingPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return undefined;
});

const { default: app } = await import("../src/server.js");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(() => {
  server = app.listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => server.close());

// Must be a public, DNS-resolvable host: SSRF validation rejects fake TLDs.
const IMAGE_URL = "https://example.com/photo.jpg";

async function aggregate(engineIds: string[], imageUrl = IMAGE_URL) {
  return fetch(`${baseUrl}/api/aggregate-search`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({ imageUrl, engineIds }),
  });
}

interface IntegrationResult {
  status: string;
  total_results: number;
  results: Array<{
    source_engine: string;
    url: string;
    thumbnail?: string;
    confidence: number;
    metadata: Record<string, string>;
  }>;
  errors: Array<{ engine_id: string }>;
}

describe("RIS external proxy — end-to-end pipeline", () => {
  test("rejects unauthenticated requests before touching adapters", async () => {
    const response = await fetch(`${baseUrl}/api/aggregate-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: IMAGE_URL, engineIds: ["saucenao"] }),
    });
    expect(response.status).toBe(401);
  });

  test("aggregates, deduplicates, and ranks results from two mocked adapters", async () => {
    const response = await aggregate(["saucenao", "bing"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-trace-id")).toBeTruthy();
    expect(response.headers.get("x-correlation-id")).toBeTruthy();

    const json = await response.json() as IntegrationResult;
    expect(json.status).toBe("success");
    expect(json.errors).toHaveLength(0);
    // 2 SauceNAO + 3 Bing − 1 duplicated URL = 4 unique results.
    expect(json.total_results).toBe(4);

    const urls = json.results.map((item) => item.url);
    expect(urls).toContain("https://source.example/art/42");
    expect(urls).toContain("https://source.example/second");
    expect(urls).toContain("https://shared.example/photo.jpg");
    expect(urls).toContain("https://bing.example/other.jpg");

    // The shared URL keeps the highest-confidence copy (SauceNAO's) and ranks first.
    expect(json.results[0]?.url).toBe("https://source.example/art/42");
    expect(json.results[0]?.source_engine).toBe("saucenao");
    expect(json.results[0]?.confidence).toBeCloseTo(0.924);
    expect(json.results[0]?.metadata.dimensions).toBe("1200x800");

    // Ranked by non-increasing confidence.
    for (let i = 1; i < json.results.length; i += 1) {
      expect(json.results[i]!.confidence).toBeLessThanOrEqual(json.results[i - 1]!.confidence);
    }

    // Every result is a normalized, sanitized shape.
    for (const item of json.results) {
      expect(item.url.startsWith("https://")).toBe(true);
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(item.metadata.domain).toBeTruthy();
    }
  });

  test("fails gracefully for unavailable engines while serving real adapter results", async () => {
    // SauceNAO results for the same image are served from the NormalizedCache;
    // TinEye is registered but has no credentials in the test env -> honest
    // per-engine error, preserving partial completion.
    const response = await aggregate(["saucenao", "tineye"]);
    expect(response.status).toBe(200);
    const json = await response.json() as IntegrationResult;
    expect(json.status).toBe("success");
    expect(json.total_results).toBe(2);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]?.engine_id).toBe("tineye");
  });

  test("serves a repeat request from the SearchCache", async () => {
    const first = await aggregate(["saucenao", "bing"]);
    const firstJson = await first.json() as IntegrationResult;
    const second = await aggregate(["saucenao", "bing"]);
    const secondJson = await second.json() as IntegrationResult;

    expect(secondJson.results).toEqual(firstJson.results);

    const health = await (await fetch(`${baseUrl}/health`)).json() as { cache_entries: number };
    expect(health.cache_entries).toBeGreaterThanOrEqual(1);
  });
});
