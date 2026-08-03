import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env.RIS_PROXY_KEY = "test-secret";
const { default: app } = await import("../src/server.js");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(() => {
  server = app.listen(0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => server.close());

describe("RIS proxy HTTP contract", () => {
  test("requires bearer authentication", async () => {
    const response = await fetch(`${baseUrl}/api/aggregate-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://example.com/image.jpg", engineIds: ["google-lens"] }),
    });
    expect(response.status).toBe(401);
  });

  test("rejects private image hosts", async () => {
    const response = await fetch(`${baseUrl}/api/aggregate-search`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: "http://127.0.0.1/image.jpg", engineIds: ["google-lens"] }),
    });
    expect(response.status).toBe(400);
  });

  test("returns an honest unavailable adapter error", async () => {
    const response = await fetch(`${baseUrl}/api/aggregate-search`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://example.com/image.jpg", engineIds: ["google-lens"] }),
    });
    expect(response.status).toBe(200);
    const json = await response.json() as { status: string; total_results: number; errors: Array<{ engine_id: string }> };
    expect(json.status).toBe("success");
    expect(json.total_results).toBe(0);
    expect(json.errors[0]?.engine_id).toBe("google-lens");
  });

  test("exposes health without credentials", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});
