import type { IImageSearchAdapter, NormalizedResult, RawSearchResult } from "../adapters/base.js";
import type { AdapterError } from "../types.js";
import { AdapterRegistry } from "./registry.js";
import { ExecutionScheduler, type SchedulerResult, type TaskPriority } from "./scheduler.js";

export interface RoutingRequest {
  imageUrl: string;
  engineIds: string[];
  priority?: TaskPriority;
  priorities?: Partial<Record<string, TaskPriority>>;
  signal?: AbortSignal;
}

export interface RoutingOutcome {
  results: NormalizedResult[];
  errors: AdapterError[];
  skipped: AdapterError[];
}

export class RoutingEngine {
  private readonly initialized = new WeakSet<IImageSearchAdapter>();

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly scheduler: ExecutionScheduler,
  ) {}

  async route(request: RoutingRequest): Promise<RoutingOutcome> {
    const defaultPriority = request.priority ?? "user_requested";
    const errors: AdapterError[] = [];
    const skipped: AdapterError[] = [];
    const tasks = [] as Array<{
      adapter: IImageSearchAdapter;
      priority: TaskPriority;
      signal?: AbortSignal;
      run: () => Promise<NormalizedResult[]>;
    }>;

    for (const id of [...new Set(request.engineIds)]) {
      const adapter = this.registry.getAdapter(id);
      if (!adapter) {
        skipped.push({ engine_id: id, error: "No adapter registered" });
        continue;
      }
      if (!adapter.capabilities.supportsUrlInput) {
        skipped.push({ engine_id: id, error: "Adapter does not support URL input" });
        continue;
      }
      if (request.signal?.aborted) {
        skipped.push({ engine_id: id, error: "Request cancelled" });
        continue;
      }
      tasks.push({
        adapter,
        priority: request.priorities?.[id] ?? defaultPriority,
        signal: request.signal,
        run: async () => {
          await this.prepare(adapter);
          if (!(await adapter.healthCheck())) throw new Error("Adapter health check failed");
          const raw: RawSearchResult[] = await adapter.execute(request.imageUrl);
          return adapter.normalize(raw);
        },
      });
    }

    const settled = await this.scheduler.execute(tasks);
    const results: NormalizedResult[] = [];
    for (const item of settled) this.collect(item, results, errors);
    return { results, errors, skipped };
  }

  private async prepare(adapter: IImageSearchAdapter): Promise<void> {
    if (this.initialized.has(adapter)) return;
    await adapter.warmup();
    await adapter.initialize();
    this.initialized.add(adapter);
  }

  private collect(
    item: SchedulerResult<NormalizedResult[]>,
    results: NormalizedResult[],
    errors: AdapterError[],
  ): void {
    if (item.status === "fulfilled") {
      results.push(...(item.value ?? []));
      return;
    }
    if (item.status === "cancelled") {
      errors.push({ engine_id: item.adapterId, error: "Request cancelled" });
      return;
    }
    if (item.status === "circuit_open") {
      errors.push({ engine_id: item.adapterId, error: "Circuit open" });
      return;
    }
    errors.push({ engine_id: item.adapterId, error: "Adapter execution failed" });
  }
}
