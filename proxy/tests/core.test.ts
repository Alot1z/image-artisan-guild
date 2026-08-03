import { describe, expect, test } from "bun:test";
import type {
  EngineCapability,
  IImageSearchAdapter,
  NormalizedResult,
  RawSearchResult,
} from "../src/adapters/base.js";
import { DEFAULT_CONFIG, loadConfig } from "../src/core/config.js";
import { AdapterRegistry } from "../src/core/registry.js";
import { RoutingEngine } from "../src/core/router.js";
import { ExecutionScheduler } from "../src/core/scheduler.js";

const policies = {
  ...DEFAULT_CONFIG.policies,
  maxConcurrency: 1,
  maxRetries: 0,
  adapterTimeoutMs: 1_000,
  circuitFailureThreshold: 2,
  circuitResetTimeoutMs: 60_000,
};

class MockAdapter implements IImageSearchAdapter {
  readonly capabilities: EngineCapability = {
    supportsImageUpload: true,
    supportsUrlInput: true,
    requiresAuth: false,
    integrationType: "experimental",
  };
  warmups = 0;
  initializes = 0;
  cleanups = 0;
  constructor(
    public readonly id: string,
    private readonly executeFn: () => Promise<RawSearchResult[]> = async () => [],
  ) {}
  readonly name = this.id;
  async warmup(): Promise<void> { this.warmups += 1; }
  async initialize(): Promise<void> { this.initializes += 1; }
  async cleanup(): Promise<void> { this.cleanups += 1; }
  execute(): Promise<RawSearchResult[]> { return this.executeFn(); }
  normalize(_raw: RawSearchResult[]): NormalizedResult[] { return []; }
  async healthCheck(): Promise<boolean> { return true; }
}

describe("Configuration provider", () => {
  test("layers explicit environment values over JSON without overwriting absent values", async () => {
    const filePath = "/tmp/ris-proxy-test-config.json";
    await Bun.write(filePath, JSON.stringify({ policies: { maxConcurrency: 4, maxRetries: 1 }, port: 4100 }));

    const fromJson = loadConfig({ jsonPath: filePath, env: {} });
    expect(fromJson.port).toBe(4100);
    expect(fromJson.policies.maxConcurrency).toBe(4);
    expect(fromJson.policies.maxRetries).toBe(1);

    const fromEnv = loadConfig({ jsonPath: filePath, env: { RIS_MAX_RETRIES: "0" } });
    expect(fromEnv.policies.maxRetries).toBe(0);
  });
});

describe("ExecutionScheduler", () => {
  test("opens a circuit after the configured failure threshold", async () => {
    const adapter = new MockAdapter("failing", async () => { throw new Error("upstream down"); });
    const scheduler = new ExecutionScheduler(policies);
    const task = () => scheduler.submit({ adapter, priority: "user_requested", run: () => adapter.execute() });

    expect((await task()).status).toBe("rejected");
    expect((await task()).status).toBe("rejected");
    const third = await task();

    expect(third.status).toBe("circuit_open");
    expect(scheduler.circuitSnapshot("failing")[0]?.state).toBe("open");
  });
});

describe("RoutingEngine", () => {
  test("dispatches higher-priority adapters before optional work", async () => {
    const order: string[] = [];
    const slow = new MockAdapter("optional", async () => {
      order.push("optional");
      return [];
    });
    const fast = new MockAdapter("user", async () => {
      order.push("user");
      return [];
    });
    const registry = new AdapterRegistry().register(slow).register(fast);
    const router = new RoutingEngine(registry, new ExecutionScheduler(policies));

    const outcome = await router.route({
      imageUrl: "https://example.com/image.jpg",
      engineIds: ["optional", "user"],
      priorities: { optional: "optional", user: "user_requested" },
    });

    expect(outcome.errors).toHaveLength(0);
    expect(order).toEqual(["user", "optional"]);
    expect(fast.warmups).toBe(1);
    expect(fast.initializes).toBe(1);
  });

  test("skips registered adapters that cannot consume image URLs", async () => {
    const adapter = new MockAdapter("upload-only");
    adapter.capabilities.supportsUrlInput = false;
    const registry = new AdapterRegistry().register(adapter);
    const router = new RoutingEngine(registry, new ExecutionScheduler(policies));

    const outcome = await router.route({ imageUrl: "https://example.com/image.jpg", engineIds: ["upload-only"] });

    expect(outcome.results).toHaveLength(0);
    expect(outcome.skipped).toEqual([{ engine_id: "upload-only", error: "Adapter does not support URL input" }]);
  });
});
