import { describe, expect, test } from "bun:test";
import {
  GoogleLensAdapter,
  BrowserBlockedError,
  looksBlocked,
  unwrapGoogleUrl,
} from "../src/adapters/browser/googleLensAdapter.js";
import { providerRegistry } from "../src/adapters/manager.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { ExecutionScheduler } from "../src/core/scheduler.js";
import type {
  BrowserHandleLike,
  BrowserLocatorLike,
  BrowserPageLike,
} from "../src/adapters/browser/baseBrowserAdapter.js";

function fakeImg(attrs: Record<string, string | null>): Element {
  return { getAttribute: (name: string) => attrs[name] ?? null } as unknown as Element;
}

function fakeAnchor(
  href: string,
  imgAttrs: Record<string, string | null> | null = null,
  title: string | null = null,
  text: string | null = null,
): Element {
  const attrs: Record<string, string | null> = { href, ...(title !== null ? { title } : {}) };
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    querySelector: (selector: string) => (selector === "img" && imgAttrs ? fakeImg(imgAttrs) : null),
    textContent: text,
  } as unknown as Element;
}

class FakeLocator implements BrowserLocatorLike {
  constructor(private readonly elements: Element[]) {}
  count(): Promise<number> { return Promise.resolve(this.elements.length); }
  evaluateAll<T>(fn: (elements: Element[], ...args: unknown[]) => T): Promise<T> {
    return Promise.resolve(fn(this.elements));
  }
  first(): BrowserLocatorLike { return new FakeLocator(this.elements.slice(0, 1)); }
}

interface FakePageOptions {
  anchors: Element[];
  failSelector?: boolean;
  content?: string;
}

class FakePage implements BrowserPageLike {
  readonly gotoCalls: string[] = [];
  constructor(private readonly options: FakePageOptions) {}
  goto(url: string): Promise<unknown> {
    this.gotoCalls.push(url);
    return Promise.resolve(undefined);
  }
  waitForSelector(): Promise<unknown> {
    if (this.options.failSelector) return Promise.reject(new Error("selector timeout"));
    return Promise.resolve(undefined);
  }
  waitForTimeout(): Promise<void> { return Promise.resolve(); }
  locator(selector: string): BrowserLocatorLike {
    return new FakeLocator(this.options.anchors);
  }
  content(): Promise<string> { return Promise.resolve(this.options.content ?? ""); }
  close(): Promise<void> { return Promise.resolve(); }
}

class FakeBrowser implements BrowserHandleLike {
  constructor(private readonly pageFactory: () => FakePage) {}
  newPage(): Promise<BrowserPageLike> { return Promise.resolve(this.pageFactory()); }
  close(): Promise<void> { return Promise.resolve(); }
}

describe("GoogleLensAdapter", () => {
  test("warmup launches a browser and execute scrapes + normalizes a results DOM", async () => {
    const anchors = [
      fakeAnchor("https://source.example/art/a.jpg", { src: "https://thumb.example/a_t.jpg", width: "640", height: "480" }, null, "Match A"),
      fakeAnchor("https://www.google.com/url?q=https%3A%2F%2Fsource.example%2Fb", null, null, "Match B"),
      fakeAnchor("javascript:alert(1)"),
      fakeAnchor("https://lens.google.com/intl/en/", null, null, "Lens chrome"),
    ];
    const page = new FakePage({ anchors });
    let created = false;
    const adapter = new GoogleLensAdapter({
      browserFactory: async () => {
        created = true;
        return new FakeBrowser(() => page);
      },
      uploadUrl: "https://lens.google.com/uploadbyurl",
      settleDelayMs: 0,
    });

    await adapter.warmup();
    expect(created).toBe(true);
    expect(await adapter.healthCheck()).toBe(true);

    const raw = await adapter.execute("https://images.example/input.jpg");
    const results = adapter.normalize(raw);

    expect(page.gotoCalls[0]).toBe("https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fimages.example%2Finput.jpg");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      source_engine: "google-lens",
      url: "https://source.example/art/a.jpg",
      thumbnail: "https://thumb.example/a_t.jpg",
    });
    expect(results[0]?.metadata).toMatchObject({ domain: "source.example", dimensions: "640x480" });
    expect(results[1]?.url).toBe("https://source.example/b");
    expect(results[0]!.confidence).toBeGreaterThan(results[1]!.confidence);

    await adapter.cleanup();
    expect(await adapter.healthCheck()).toBe(false);
  });

  test("fails gracefully on a blocked page and trips the circuit breaker", async () => {
    const adapter = new GoogleLensAdapter({
      browserFactory: async () => new FakeBrowser(() => new FakePage({
        anchors: [],
        failSelector: true,
        content: "<html><body>Our systems have detected unusual traffic from your computer network.</body></html>",
      })),
      settleDelayMs: 0,
    });
    const scheduler = new ExecutionScheduler({
      ...DEFAULT_CONFIG.policies,
      maxConcurrency: 1,
      maxRetries: 0,
      adapterTimeoutMs: 2_000,
      circuitFailureThreshold: 2,
    });
    await adapter.warmup();

    const run = () => scheduler.submit({
      adapter,
      priority: "user_requested",
      run: () => adapter.execute("https://images.example/input.jpg"),
    });

    const first = await run();
    expect(first.status).toBe("rejected");
    expect((first.error as Error).name).toBe("BrowserBlockedError");
    expect((await run()).status).toBe("rejected");
    const third = await run();
    expect(third.status).toBe("circuit_open");
    expect(scheduler.circuitSnapshot("google-lens")[0]?.state).toBe("open");
    await adapter.cleanup();
  });

  test("returns an empty result set when the page loads without matches", async () => {
    const adapter = new GoogleLensAdapter({
      browserFactory: async () => new FakeBrowser(() => new FakePage({
        anchors: [],
        failSelector: true,
        content: "<html><body>No results found for this image.</body></html>",
      })),
      settleDelayMs: 0,
    });
    await adapter.warmup();
    expect(await adapter.execute("https://images.example/input.jpg")).toEqual([]);
    await adapter.cleanup();
  });

  test("throws before warmup if executed without a browser", async () => {
    const adapter = new GoogleLensAdapter({
      browserFactory: async () => new FakeBrowser(() => new FakePage({ anchors: [] })),
    });
    await expect(adapter.execute("https://images.example/input.jpg")).rejects.toThrow(/not been warmed up/);
  });

  test("helper functions classify blocking signals and unwrap redirect URLs", () => {
    expect(looksBlocked("Please verify you are not a robot")).toBe(true);
    expect(looksBlocked("All clear, here are your results")).toBe(false);
    expect(unwrapGoogleUrl("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fx")).toBe("https://example.com/x");
    expect(unwrapGoogleUrl("https://example.com/direct")).toBe("https://example.com/direct");
    expect(unwrapGoogleUrl("javascript:alert(1)")).toBeUndefined();
    expect(unwrapGoogleUrl("https://lens.google.com/intl/en/")).toBe("https://lens.google.com/intl/en/");
  });

  test("is explicitly registered under the google-lens engine id", () => {
    const adapter = providerRegistry().getAdapter("google-lens");
    expect(adapter).toBeInstanceOf(GoogleLensAdapter);
    expect(adapter?.capabilities.supportsUrlInput).toBe(true);
    expect(adapter?.capabilities.integrationType).toBe("playwright");
  });
});
