import { HttpStatusError } from "./types.js";

interface LogFields {
  event: string;
  request_id?: string;
  engine_id?: string;
  [key: string]: unknown;
}

export function log(fields: LogFields): void {
  // Never include image URLs, authorization headers, API keys, or raw adapter
  // payloads in structured logs.
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "ris-external-proxy",
    ...fields,
  }));
}

export function safeAdapterError(error: unknown): string {
  if (error instanceof HttpStatusError) {
    if (error.status === 401 || error.status === 403) return `${error.status} Forbidden`;
    if (error.status === 429) return "Rate limited";
    return `HTTP ${error.status}`;
  }
  if (error instanceof Error && error.name === "AbortError") return "Timeout exceeded";
  if (error instanceof Error && error.name === "AdapterNotImplementedError") return error.message;
  if (error instanceof Error && error.name === "BrowserBlockedError") return "Upstream blocked the automated request";
  return "Adapter execution failed";
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === 429;
}
