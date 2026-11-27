import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { route } = await import("@/lib/api");

const pg = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("pg"), { code, ...extra });
const ask = (err: unknown) =>
  route(async () => {
    throw new Error("Failed query", { cause: err });
  })(new Request("http://localhost/api/tasks/x", { method: "PATCH" }), {});

afterEach(() => vi.restoreAllMocks());

/* A rolled back race or a lost connection is a busy database, and a retry may pass. */
describe("A route the database could not answer", () => {
  it.each(["40P01", "40001", "08006", "57P01", "57P02", "57P03"])(
    "answers %s with 503 and Retry-After",
    async (code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = await ask(pg(code));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ error: "The server is busy. Try again in a moment." });
      expect(log).toHaveBeenCalledWith(
        "[ushabti] database busy",
        code,
        "PATCH",
        "/api/tasks/x",
        expect.anything(),
      );
    },
  );

  it("answers a lost connection with 503 too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await ask(new Error("Connection terminated unexpectedly"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("still answers a unique violation nobody claims with 500, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await ask(pg("23505", { constraint: "users_email_key" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(await res.json()).toEqual({ error: "Something went wrong on the server." });
    expect(log).toHaveBeenCalledWith("[ushabti] route error", expect.anything());
  });
});
