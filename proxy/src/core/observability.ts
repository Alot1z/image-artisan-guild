import crypto from "node:crypto";

export interface TraceContext {
  trace_id?: string;
  correlation_id?: string;
  [key: string]: unknown;
}

export type StructuredLog = (fields: Record<string, unknown>) => void;

export function newTraceId(): string {
  return crypto.randomUUID();
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Returns a structured JSON logger bound to a trace context. Never include
 * image URLs, authorization headers, or API keys in logged fields.
 */
export function createLogger(context: TraceContext = {}): StructuredLog {
  return (fields: Record<string, unknown>): void => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "ris-external-proxy",
      ...context,
      ...fields,
    }));
  };
}

/** Milliseconds elapsed since a Date.now() snapshot. */
export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
