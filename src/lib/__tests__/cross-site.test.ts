import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({}));

const { crossSite, route } = await import("../api");

const at = (method: string, headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/tasks/x", { method, headers });

describe("crossSite", () => {
  it("refuses a write from another site, a sibling subdomain too", () => {
    expect(
      crossSite(at("POST", { host: "board.example.com", origin: "https://evil.example" })),
    ).toBe(true);
    expect(
      crossSite(at("PATCH", { host: "board.example.com", origin: "https://blog.example.com" })),
    ).toBe(true);
    expect(crossSite(at("DELETE", { host: "board.example.com", origin: "null" }))).toBe(true);
  });

  it("lets a write from this site through, behind a proxy too", () => {
    expect(crossSite(at("POST", { host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(
      false,
    );
    expect(
      crossSite(
        at("POST", {
          host: "app:3000",
          "x-forwarded-host": "board.example.com",
          origin: "https://board.example.com",
        }),
      ),
    ).toBe(false);
  });

  it("lets a write with no Origin through, as an agent's token sends it", () => {
    expect(crossSite(at("POST", { host: "board.example.com", authorization: "Bearer t" }))).toBe(
      false,
    );
  });

  it("never refuses a read", () => {
    expect(
      crossSite(at("GET", { host: "board.example.com", origin: "https://evil.example" })),
    ).toBe(false);
  });

  it("answers 403 before the handler runs", async () => {
    const handler = vi.fn(async () => new Response("ran"));
    const res = await route(handler)(
      at("POST", { host: "board.example.com", origin: "https://evil.example" }),
      {},
    );
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
