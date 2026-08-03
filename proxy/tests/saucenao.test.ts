import { describe, expect, test } from "bun:test";
import { SauceNaoApiAdapter } from "../src/adapters/api/sauceNaoAdapter.js";
import { providerRegistry } from "../src/adapters/manager.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { ExecutionScheduler } from "../src/core/scheduler.js";

const responsePayload = {
  results: [
    {
      header: {
        similarity: "92.40",
        thumbnail: "https://img.example/thumb.jpg",
      },
      data: {
        ext_urls: ["not-a-url", "https://source.example/art/42"],
        title: "Archived plate",
        creator: "A. Archivist",
        width: 1200,
        height: 800,
      },
    },
    {
      header: { similarity: "61.2", thumbnail: "javascript:alert(1)" },
      data: { source: "https://source.example/second", author: "Unknown" },
    },
  ],
};

describe("SauceNaoApiAdapter", () => {
  test("constructs the documented URL request and normalizes JSON results", async () => {
    let requestedUrl = "";
    const adapter = new SauceNaoApiAdapter({
      apiKey: "test-key",
      endpoint: "https://saucenao.test/search.php",
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const raw = await adapter.execute("https://images.example/input.jpg");
    const results = adapter.normalize(raw);
    const url = new URL(requestedUrl);

    expect(url.pathname).toBe("/search.php");
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(url.searchParams.get("output_type")).toBe("2");
    expect(url.searchParams.get("numres")).toBe("30");
    expect(url.searchParams.get("url")).toBe("https://images.example/input.jpg");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source_engine: "saucenao",
      url: "https://source.example/art/42",
      thumbnail: "https://img.example/thumb.jpg",
      confidence: 0.924,
    });
    expect(results[0]?.metadata).toMatchObject({
      domain: "source.example",
      title: "Archived plate",
      dimensions: "1200x800",
    });
    expect(results[1]?.thumbnail).toBeUndefined();
  });

  test("retries transient API failures inside the reusable API base", async () => {
    let attempts = 0;
    const adapter = new SauceNaoApiAdapter({
      apiKey: "test-key",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("busy", { status: 503 });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
      maxRetries: 1,
      retryDelayMs: 0,
    });

    expect(await adapter.execute("https://images.example/input.jpg")).toEqual([]);
    expect(attempts).toBe(2);
  });

  test("leaves execution timeout policy to the scheduler", async () => {
    const adapter = new SauceNaoApiAdapter({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        setTimeout(() => reject(new Error("simulated slow network")), 25);
      }),
    });
    const scheduler = new ExecutionScheduler({
      ...DEFAULT_CONFIG.policies,
      maxConcurrency: 1,
      maxRetries: 0,
      adapterTimeoutMs: 5,
    });

    const outcome = await scheduler.submit({
      adapter,
      priority: "user_requested",
      run: () => adapter.execute("https://images.example/input.jpg"),
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.error).toBeInstanceOf(Error);
    expect((outcome.error as Error).name).toBe("TimeoutError");
  });

  test("is explicitly registered under the existing engine id", () => {
    expect(providerRegistry().getAdapter("saucenao")).toBeInstanceOf(SauceNaoApiAdapter);
  });
});
