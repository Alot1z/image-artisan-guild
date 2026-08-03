import type { IImageSearchAdapter } from "../adapters/base.js";
import { AdapterNotImplementedError } from "../types.js";
import type { OperationalPolicies } from "./config.js";

export type TaskPriority = "user_requested" | "recommended" | "optional";

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  user_requested: 0,
  recommended: 1,
  optional: 2,
};

export interface SchedulerTask<T> {
  adapter: IImageSearchAdapter;
  priority: TaskPriority;
  run: () => Promise<T>;
  signal?: AbortSignal;
}

export interface SchedulerResult<T> {
  adapterId: string;
  status: "fulfilled" | "rejected" | "cancelled" | "circuit_open";
  value?: T;
  error?: unknown;
}

type CircuitState = "closed" | "open" | "half-open";

interface Circuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
  probeInFlight: boolean;
}

export interface CircuitSnapshot {
  adapterId: string;
  state: CircuitState;
  failures: number;
  openedAt: number;
}

interface QueueEntry<T> {
  task: SchedulerTask<T>;
  sequence: number;
  resolve: (result: SchedulerResult<T>) => void;
}

export class CircuitOpenError extends Error {
  constructor(adapterId: string) {
    super(`Circuit open for adapter ${adapterId}`);
    this.name = "CircuitOpenError";
  }
}

export class SchedulerTimeoutError extends Error {
  constructor(adapterId: string) {
    super(`Timeout exceeded for adapter ${adapterId}`);
    this.name = "TimeoutError";
  }
}

export class ExecutionScheduler {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private readonly circuits = new Map<string, Circuit>();
  private sequence = 0;
  private active = 0;
  private draining = false;
  private stopped = false;

  constructor(private readonly policies: OperationalPolicies) {}

  submit<T>(task: SchedulerTask<T>): Promise<SchedulerResult<T>> {
    if (this.stopped) {
      return Promise.resolve({ adapterId: task.adapter.id, status: "cancelled" });
    }
    return new Promise<SchedulerResult<T>>((resolve) => {
      this.queue.push({ task: task as SchedulerTask<unknown>, sequence: this.sequence++, resolve: resolve as (result: SchedulerResult<unknown>) => void });
      this.queue.sort((a, b) => PRIORITY_WEIGHT[a.task.priority] - PRIORITY_WEIGHT[b.task.priority] || a.sequence - b.sequence);
      this.drain();
    });
  }

  async execute<T>(tasks: SchedulerTask<T>[]): Promise<SchedulerResult<T>[]> {
    return Promise.all(tasks.map((task) => this.submit(task)));
  }

  cancelQueued(reason = "Scheduler stopped"): number {
    let cancelled = 0;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;
      cancelled += 1;
      entry.resolve({ adapterId: entry.task.adapter.id, status: "cancelled", error: new Error(reason) });
    }
    return cancelled;
  }

  stop(): void {
    this.stopped = true;
    this.cancelQueued();
  }

  get pendingCount(): number { return this.queue.length; }
  get activeCount(): number { return this.active; }

  circuitSnapshot(adapterId?: string): CircuitSnapshot[] {
    return [...this.circuits.entries()]
      .filter(([id]) => !adapterId || id === adapterId)
      .map(([id, circuit]) => ({ adapterId: id, state: circuit.state, failures: circuit.failures, openedAt: circuit.openedAt }));
  }

  recordHealth(adapterId: string, healthy: boolean): void {
    const circuit = this.circuitFor(adapterId);
    if (healthy) {
      circuit.failures = 0;
      circuit.state = "closed";
      circuit.openedAt = 0;
      circuit.probeInFlight = false;
    } else {
      this.recordFailure(adapterId, new Error("Health probe failed"));
    }
  }

  private circuitFor(adapterId: string): Circuit {
    const existing = this.circuits.get(adapterId);
    if (existing) return existing;
    const created: Circuit = { state: "closed", failures: 0, openedAt: 0, probeInFlight: false };
    this.circuits.set(adapterId, created);
    return created;
  }

  private canRun(adapterId: string): boolean {
    const circuit = this.circuitFor(adapterId);
    if (circuit.state === "closed") return true;
    if (circuit.state === "open" && Date.now() - circuit.openedAt >= this.policies.circuitResetTimeoutMs) {
      circuit.state = "half-open";
      circuit.probeInFlight = false;
    }
    if (circuit.state === "half-open" && !circuit.probeInFlight) {
      circuit.probeInFlight = true;
      return true;
    }
    return false;
  }

  private recordSuccess(adapterId: string): void {
    const circuit = this.circuitFor(adapterId);
    circuit.failures = 0;
    circuit.state = "closed";
    circuit.openedAt = 0;
    circuit.probeInFlight = false;
  }

  private recordFailure(adapterId: string, error: unknown): void {
    if (error instanceof AdapterNotImplementedError) return;
    const circuit = this.circuitFor(adapterId);
    circuit.probeInFlight = false;
    circuit.failures += 1;
    if (circuit.failures >= this.policies.circuitFailureThreshold) {
      circuit.state = "open";
      circuit.openedAt = Date.now();
    }
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      while (!this.stopped && this.active < this.policies.maxConcurrency && this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry) break;
        void this.runEntry(entry);
      }
    });
  }

  private async runEntry(entry: QueueEntry<unknown>): Promise<void> {
    const { task } = entry;
    if (task.signal?.aborted) {
      entry.resolve({ adapterId: task.adapter.id, status: "cancelled" });
      this.drain();
      return;
    }
    if (!this.canRun(task.adapter.id)) {
      entry.resolve({ adapterId: task.adapter.id, status: "circuit_open", error: new CircuitOpenError(task.adapter.id) });
      this.drain();
      return;
    }

    this.active += 1;
    try {
      const value = await Promise.race([
        this.runWithPolicy(task),
        this.abortPromise(task.signal),
      ]);
      this.recordSuccess(task.adapter.id);
      entry.resolve({ adapterId: task.adapter.id, status: "fulfilled", value });
    } catch (error) {
      if (task.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        entry.resolve({ adapterId: task.adapter.id, status: "cancelled", error });
      } else {
        this.recordFailure(task.adapter.id, error);
        entry.resolve({ adapterId: task.adapter.id, status: "rejected", error });
      }
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  private async runWithPolicy<T>(task: SchedulerTask<T>): Promise<T> {
    let lastError: unknown = new Error("Task failed");
    for (let attempt = 0; attempt <= this.policies.maxRetries; attempt += 1) {
      try {
        return await Promise.race([
          task.run(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new SchedulerTimeoutError(task.adapter.id)), this.policies.adapterTimeoutMs)),
        ]);
      } catch (error) {
        lastError = error;
        if (error instanceof AdapterNotImplementedError || attempt >= this.policies.maxRetries) throw error;
      }
    }
    throw lastError;
  }

  private abortPromise(signal?: AbortSignal): Promise<never> {
    if (!signal) return new Promise<never>(() => undefined);
    if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    return new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true });
    });
  }
}
