// Shared test bootstrap for the RIS proxy test suite.
//
// Deterministic credentials are set at the PROCESS level by the npm test
// script (package.json) so the app singleton — server -> manager ->
// core/config, which loads exactly once — is configured identically for every
// test file regardless of import order. The lines below are a convenience for
// running a single file directly (`bun test tests/integration.test.ts`).
//
// This module also installs a global upstream fetch dispatcher and exposes
// mockUpstream() so tests can stub adapter HTTP without depending on when the
// app singleton was constructed.

process.env.RIS_PROXY_KEY ??= "test-secret";
process.env.SAUCENAO_API_KEY ??= "test-saucenao-key";
process.env.BING_VISUAL_SEARCH_API_KEY ??= "test-bing-key";

type UpstreamHandler = (url: string) => Response | Promise<Response> | undefined;
const handlers: UpstreamHandler[] = [];

/**
 * Register a handler for upstream URLs during tests. Handlers are consulted in
 * registration order and may return undefined to fall through.
 */
export function mockUpstream(handler: UpstreamHandler): void {
  handlers.push(handler);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  for (const handler of handlers) {
    const result = await handler(url);
    if (result) return result;
  }
  return realFetch(input, init);
};
