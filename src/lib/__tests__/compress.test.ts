import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { acceptedEncoding, fail, json, route } = await import("@/lib/api");

const big = { tasks: Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Task ${i}` })) };

async function answer(made: () => Response, accept?: string) {
  const handler = route(async () => made());
  const headers: Record<string, string> = accept ? { "accept-encoding": accept } : {};
  const res = await handler(new Request("http://localhost/api/x", { headers }), {});
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

describe("Packing a JSON answer", () => {
  it("reads which coding the caller takes", () => {
    expect(acceptedEncoding("gzip, deflate, br")).toBe("br");
    expect(acceptedEncoding("gzip")).toBe("gzip");
    expect(acceptedEncoding("br;q=0, gzip;q=0.5")).toBe("gzip");
    expect(acceptedEncoding("identity")).toBeNull();
    expect(acceptedEncoding(null)).toBeNull();
  });

  it("packs a large answer with gzip or br", async () => {
    const gz = await answer(() => json(big), "gzip");
    expect(gz.res.headers.get("content-encoding")).toBe("gzip");
    expect(gz.res.headers.get("vary")).toMatch(/Accept-Encoding/);
    expect(gz.res.headers.get("content-length")).toBe(String(gz.bytes.length));
    expect(JSON.parse(gunzipSync(gz.bytes).toString())).toEqual(big);

    const br = await answer(() => json(big), "gzip, br");
    expect(br.res.headers.get("content-encoding")).toBe("br");
    expect(JSON.parse(brotliDecompressSync(br.bytes).toString())).toEqual(big);
  });

  it("answers plain to a caller that names no coding", async () => {
    const { res, bytes } = await answer(() => json(big, 201));
    expect(res.status).toBe(201);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("vary")).toMatch(/Accept-Encoding/);
    expect(JSON.parse(bytes.toString())).toEqual(big);
  });

  it("leaves a small answer plain, and keeps its headers", async () => {
    const { res, bytes } = await answer(
      () => fail(429, "Slow down.", { "Retry-After": "5" }),
      "gzip",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("retry-after")).toBe("5");
    expect(JSON.parse(bytes.toString())).toEqual({ error: "Slow down." });
  });

  it("leaves an answer that is not JSON alone", async () => {
    const stream = new Response("event: ready\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
    const { res } = await answer(() => stream, "gzip");
    expect(res).toBe(stream);
  });
});
