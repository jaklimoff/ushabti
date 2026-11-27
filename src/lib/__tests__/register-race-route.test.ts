import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

/* The other submit of the same form lands while this one hashes the password. */
const race = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/lib/auth", async (original) => {
  const auth = await original<typeof import("@/lib/auth")>();
  return {
    ...auth,
    signupIsOpen: () => true,
    hashPassword: async (password: string) => {
      if (race.email) {
        const { db } = await import("@/db");
        const { users } = await import("@/db/schema");
        await db
          .insert(users)
          .values({ email: race.email, name: "First submit", passwordHash: "x", color: "#888888" });
      }
      return auth.hashPassword(password);
    },
  };
});

const { db } = await import("@/db");
const { users } = await import("@/db/schema");
const { api } = await import("@/test/route");

describe("Two submits of one sign-up", () => {
  it("answer the second that the account exists", async () => {
    race.email = "twice@example.com";
    const res = await api(null).post("/api/auth/register", {
      email: race.email,
      name: "Second submit",
      password: "long enough",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "An account with that email already exists." });
    const rows = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.email, race.email));
    expect(rows).toEqual([{ name: "First submit" }]);
  });
});
