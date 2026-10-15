import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));

const { db } = await import("@/db");
const { GET } = await import("@/app/api/health/route");

afterEach(() => vi.restoreAllMocks());

/* The route is called with nothing: no cookie, no token, no request at all. */
describe("GET /api/health", () => {
  it("answers 200 when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers 503 when the database does not", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "The database does not answer." });
  });
});
