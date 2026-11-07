import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { json, route } = await import("@/lib/api");

const big = { tasks: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Task ${i}` })) };

/* Next 16.4.5 strips Content-Encoding from a route's answer and sends the
   bytes as they are, so an answer packed here reaches the browser as noise
   (vercel/next.js#101192). Packing is the server's, never a route's. */
describe("A JSON answer", () => {
  it("leaves the route plain, even when the caller takes gzip or br", async () => {
    const handler = route(async () => json(big));
    const req = new Request("http://localhost/api/x", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    const res = await handler(req, {});
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual(big);
  });
});
