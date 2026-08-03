export type IntegrationType =
  | "official_api"
  | "partner_api"
  | "playwright"
  | "experimental"
  | "unavailable";

export interface EngineCapability {
  supportsImageUpload: boolean;
  supportsUrlInput: boolean;
  requiresAuth: boolean;
  integrationType: IntegrationType;
}

export interface RawSearchResult {
  [key: string]: unknown;
}

export interface NormalizedResult {
  source_engine: string;
  url: string;
  thumbnail?: string;
  confidence: number;
  metadata: Record<string, string>;
}

export interface IImageSearchAdapter {
  id: string;
  name: string;
  capabilities: EngineCapability;
  execute(imageUrl: string): Promise<RawSearchResult[]>;
  normalize(raw: RawSearchResult[]): NormalizedResult[];
  healthCheck(): Promise<boolean>;
}

export interface AdapterError {
  engine_id: string;
  error: string;
}

export interface AggregateResponse {
  status: "success";
  request_id: string;
  total_results: number;
  results: NormalizedResult[];
  errors: AdapterError[];
}

export interface AggregateRequest {
  imageUrl: string;
  engineIds: string[];
}

export class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export class AdapterNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterNotImplementedError";
  }
}
