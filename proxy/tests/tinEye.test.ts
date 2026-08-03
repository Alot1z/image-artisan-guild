import { describe, expect, test } from "bun:test";
import { TinEyeApiAdapter } from "../src/adapters/api/tinEyeAdapter.js";
import { SauceNaoApiAdapter } from "../src/adapters/api/sauceNaoAdapter.js";
import { providerRegistry } from "../src/adapters/manager.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { ExecutionScheduler } from "../src/core/scheduler.js";

const responsePayload = {
  status: "ok",
  results: [
    {
      image_url: "https://images.example/tineye/1.jpg",
      width: 1200,
      height: 800,
      file_size: 123456,
      match_score: "92.30",
      backlinks: [
        { backlink: "Archived page", url: "https://source.example/archived", crawl_date: "2026-01-01" },
      ],
    },
    {
      image_url: "javascript:alert(1)",
      match_score: "70.0",
    },
    {
      image_url: "https://images.example/tineye/2.jpg",
      match_score: "61.2",
    },
  ],
};

describe("TinEyeApiAdapter", () => {
  test("constructs the documented URL request (Basic auth) and normalizes JSON results", async () => {
    let requestedUrl = "";
    let authHeader = "";
    const adapter = new TinEyeApiAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
      endpoint: "https://tineye.test/rest/search/",
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        const headers = new Headers(init?.headers);
        authHeader = headers.get("authorization") ?? "";
        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const raw = await adapter.execute("https://images.example/input.jpg");
    const results = adapter.normalize(raw);
    const url = new URL(requestedUrl);

    expect(url.pathname).toBe("/rest/search/");
    expect(url.searchParams.get("url")).toBe("https://images.example/input.jpg");
    expect(url.searchParams.get("limit")).toBe("15");
    expect(authHeader).toBe(`Basic ${Buffer.from("test-key:test-secret").toString("base64")}`);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source_engine: "tineye",
      url: "https://images.example/tineye/1.jpg",
      thumbnail: "https://images.example/tineye/1.jpg",
    });
    expect(results[0]?.confidence).toBeCloseTo(0.923, 6);
    expect(results[0]?.metadata).toMatchObject({
      domain: "images.example",
      title: "Archived page",
      dimensions: "1200x800",
    });
    expect(results[1]?.url).toBe("https://images.example/tineye/2.jpg");
  });

  test("fails honestly when credentials are missing", async () => {
    const adapter = new TinEyeApiAdapter({
      apiKey: "",
      apiSecret: "",
      fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    expect(await adapter.healthCheck()).toBe(false);
    await expect(adapter.execute("https://images.example/input.jpg")).rejects.toThrow(
      "TinEye adapter is not configured",
    );
  });

  test("retries transient API failures inside the reusable API base", async () => {
    let attempts = 0;
    const adapter = new TinEyeApiAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
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

  test("throws a structured error for invalid upstream responses", async () => {
    const adapter = new TinEyeApiAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
      fetchImpl: async () => new Response(JSON.stringify({ status: "error" }), { status: 200 }),
    });
    await expect(adapter.execute("https://images.example/input.jpg")).rejects.toThrow(
      "TinEye returned an invalid response",
    );
  });

  test("leaves execution timeout policy to the scheduler", async () => {
    const adapter = new TinEyeApiAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
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

  test("a failing TinEye execution trips the circuit breaker without breaking other adapters", async () => {
    let calls = 0;
    const failing = new TinEyeApiAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
      fetchImpl: async () => {
        calls += 1;
        return new Response("upstream error", { status: 500 });
      },
    });
    // The circuit breaker is keyed by adapter id, so an unrelated adapter
    // must be a different engine entirely (here: SauceNAO).
    const healthy = new SauceNaoApiAdapter({
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const scheduler = new ExecutionScheduler({
      ...DEFAULT_CONFIG.policies,
      maxConcurrency: 1,
      maxRetries: 0,
      circuitFailureThreshold: 2,
    });

    await scheduler.submit({ adapter: failing, priority: "user_requested", run: () => failing.execute("https://images.example/input.jpg") });
    await scheduler.submit({ adapter: failing, priority: "user_requested", run: () => failing.execute("https://images.example/input.jpg") });

    const snapshot = scheduler.circuitSnapshot("tineye");
    expect(snapshot[0]?.state).toBe("open");
    expect(calls).toBe(2);

    // The circuit is open for tineye, but an unrelated adapter still executes.
    const healthyOutcome = await scheduler.submit({ adapter: healthy, priority: "user_requested", run: () => healthy.execute("https://images.example/input.jpg") });
    expect(healthyOutcome.status).toBe("fulfilled");
  });

  test("is explicitly registered under the existing engine id", () => {
    const adapter = providerRegistry().getAdapter("tineye");
    expect(adapter).toBeInstanceOf(TinEyeApiAdapter);
    expect(adapter?.capabilities.integrationType).toBe("official_api");
    expect(adapter?.capabilities.supportsUrlInput).toBe(true);
  });
});
