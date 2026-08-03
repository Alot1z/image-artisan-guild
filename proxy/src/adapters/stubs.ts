import { AdapterNotImplementedError, type EngineCapability, type IImageSearchAdapter, type NormalizedResult, type RawSearchResult } from "../types.js";

export class UnavailableAdapter implements IImageSearchAdapter {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly capabilities: EngineCapability,
    private readonly reason: string,
  ) {}

  async execute(_imageUrl: string): Promise<RawSearchResult[]> {
    throw new AdapterNotImplementedError(this.reason);
  }

  normalize(_raw: RawSearchResult[]): NormalizedResult[] { return []; }

  async healthCheck(): Promise<boolean> { return false; }
}

export function unavailableAdapter(id: string, name = id): UnavailableAdapter {
  return new UnavailableAdapter(
    id,
    name,
    {
      supportsImageUpload: false,
      supportsUrlInput: false,
      requiresAuth: false,
      integrationType: "unavailable",
    },
    "No permitted adapter is configured for this engine",
  );
}

export const tinEyeStub = new UnavailableAdapter(
  "tineye",
  "TinEye",
  {
    supportsImageUpload: true,
    supportsUrlInput: false,
    requiresAuth: true,
    integrationType: "unavailable",
  },
  "TinEye adapter unavailable: configure a permitted account-specific API integration",
);

export const googleLensStub = new UnavailableAdapter(
  "google-lens",
  "Google Lens",
  {
    supportsImageUpload: false,
    supportsUrlInput: false,
    requiresAuth: false,
    integrationType: "experimental",
  },
  "Google Lens adapter is experimental and not enabled in this proxy",
);
