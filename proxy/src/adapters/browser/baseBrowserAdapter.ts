import type {
  EngineCapability,
  IImageSearchAdapter,
  NormalizedResult,
  RawSearchResult,
} from "../base.js";

/**
 * Minimal structural subset of the Playwright Browser/Page/Locator surface
 * used by browser adapters. Playwright's real types satisfy these interfaces,
 * and tests inject lightweight fakes that implement them.
 */
export interface BrowserLocatorLike {
  count(): Promise<number>;
  evaluateAll<T>(fn: (elements: Element[], ...args: unknown[]) => T): Promise<T>;
  first(): BrowserLocatorLike;
}

export interface BrowserPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number; state?: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): BrowserLocatorLike;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserHandleLike {
  newPage(): Promise<BrowserPageLike>;
  close(): Promise<void>;
}

export interface BrowserAdapterOptions {
  /** Injectable browser factory; defaults to a Playwright Chromium launch. */
  browserFactory?: () => Promise<BrowserHandleLike>;
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  /** Extra Chromium flags appended after the default detection-mitigation set. */
  stealthArgs?: string[];
  launchTimeoutMs?: number;
  navigationTimeoutMs?: number;
}

export class BrowserNotReadyError extends Error {
  constructor(adapterId: string) {
    super(`Browser adapter ${adapterId} has not been warmed up`);
    this.name = "BrowserNotReadyError";
  }
}

const DEFAULT_STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--disable-setuid-sandbox",
];

export abstract class BaseBrowserAdapter implements IImageSearchAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: EngineCapability;

  protected browser: BrowserHandleLike | undefined;
  private warming: Promise<void> | undefined;

  private readonly browserFactory: () => Promise<BrowserHandleLike>;
  private readonly headless: boolean;
  private readonly viewport: { width: number; height: number };
  private readonly userAgent?: string;
  private readonly locale?: string;
  private readonly timezoneId?: string;
  private readonly stealthArgs: string[];
  protected readonly launchTimeoutMs: number;
  protected readonly navigationTimeoutMs: number;

  constructor(options: BrowserAdapterOptions = {}) {
    this.browserFactory = options.browserFactory ?? (() => this.launchChromium());
    this.headless = options.headless ?? true;
    this.viewport = options.viewport ?? { width: 1366, height: 768 };
    this.userAgent = options.userAgent;
    this.locale = options.locale;
    this.timezoneId = options.timezoneId;
    this.stealthArgs = [...DEFAULT_STEALTH_ARGS, ...(options.stealthArgs ?? [])];
    this.launchTimeoutMs = options.launchTimeoutMs ?? 20_000;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 15_000;
  }

  /** Launch (once) the shared browser context used by this adapter. */
  async warmup(): Promise<void> {
    if (this.browser) return;
    if (!this.warming) {
      this.warming = (async () => {
        const launched = await this.withTimeout(
          this.browserFactory(),
          this.launchTimeoutMs,
          `Browser launch timed out for ${this.id}`,
        );
        this.browser = launched;
      })().finally(() => {
        this.warming = undefined;
      });
    }
    await this.warming;
  }

  /** Optional per-adapter preparation hook; nothing to do by default. */
  async initialize(): Promise<void> {}

  /** Close the shared browser context, if one was launched. */
  async cleanup(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close();
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.browser);
  }

  protected async openPage(): Promise<BrowserPageLike> {
    const browser = this.browser;
    if (!browser) throw new BrowserNotReadyError(this.id);
    return browser.newPage();
  }

  abstract execute(imageUrl: string): Promise<RawSearchResult[]>;
  abstract normalize(raw: RawSearchResult[]): NormalizedResult[];

  private async launchChromium(): Promise<BrowserHandleLike> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: this.headless,
      args: this.stealthArgs,
    });
    const context = await browser.newContext({
      viewport: this.viewport,
      ...(this.userAgent ? { userAgent: this.userAgent } : {}),
      ...(this.locale ? { locale: this.locale } : {}),
      ...(this.timezoneId ? { timezoneId: this.timezoneId } : {}),
    });
    return {
      newPage: () => context.newPage(),
      close: () => browser.close(),
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
