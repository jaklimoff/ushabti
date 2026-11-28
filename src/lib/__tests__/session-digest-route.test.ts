import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const set = vi.hoisted(() => [] as string[]);

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
// The route test's jar drops what a handler sets; this one keeps the cookie a sign-in hands out.
vi.mock("next/headers", async () => {
  const real = await import("@/test/headers");
  return {
    ...real,
    cookies: async () => ({
      ...(await real.cookies()),
      set: (_name: string, value: string) => void set.push(value),
    }),
  };
});

const { db } = await import("@/db");
const { sessions, users } = await import("@/db/schema");
const { eq, sql } = await import("drizzle-orm");
const { hashPassword, sessionDigest } = await import("@/lib/auth");
const { api, ok, person } = await import("@/test/route");

/** Somebody with a password, and the cookie their sign-in hands back. */
async function signIn() {
  const who = await person();
  const [row] = await db
    .update(users)
    .set({ passwordHash: await hashPassword("ushabti-secret") })
    .where(eq(users.id, who.id))
    .returning({ email: users.email });
  const signedIn = async () => {
    await ok(api(null).post("/api/auth/login", { email: row.email, password: "ushabti-secret" }));
    const cookie = set.at(-1)!;
    return { ...who, headers: { cookie: `ushabti_session=${cookie}` }, cookie };
  };
  return { who, signedIn };
}

const rowsOf = (userId: string) => db.select().from(sessions).where(eq(sessions.userId, userId));

describe("A session row", () => {
  it("holds the digest of the cookie, and the cookie still signs in", async () => {
    const { who, signedIn } = await signIn();
    const me = await signedIn();

    const ids = (await rowsOf(who.id)).map((row) => row.id);
    expect(ids).not.toContain(me.cookie);
    expect(ids).toContain(sessionDigest(me.cookie));
    const answer = await ok<{ user: { id: string } }>(api(me).get("/api/auth/me"));
    expect(answer.user.id).toBe(who.id);
  });

  it("an expired one of the same person is gone after the next sign-in, and nobody else's", async () => {
    const { who, signedIn } = await signIn();
    const other = await person();
    const past = new Date(Date.now() - 60_000);
    await db.insert(sessions).values([
      { id: "dead-mine", userId: who.id, expiresAt: past },
      { id: "dead-theirs", userId: other.id, expiresAt: past },
    ]);

    await signedIn();

    expect((await rowsOf(who.id)).map((row) => row.id)).not.toContain("dead-mine");
    expect((await rowsOf(other.id)).map((row) => row.id)).toContain("dead-theirs");
  });

  it("the password change and the sessions list still know which one is this browser", async () => {
    const { who, signedIn } = await signIn();
    const here = await signedIn();
    await signedIn();

    expect(await ok<{ others: number }>(api(here).get("/api/auth/sessions"))).toEqual({
      others: 2,
    });
    await ok(
      api(here).post("/api/auth/password", { current: "ushabti-secret", next: "another-one" }),
    );
    expect((await rowsOf(who.id)).map((row) => row.id)).toEqual([sessionDigest(here.cookie)]);
    await ok(api(here).get("/api/auth/me"));
  });
});

describe("The session migration", () => {
  it("turns a raw id into the digest the helper gives", async () => {
    const who = await person();
    const raw = "a-cookie-from-before_the-change";
    const statement = readFileSync("drizzle/0041_session_digests.sql", "utf8");
    // The migration rewrites every row, so it runs on a copy of the table.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`create temporary table "sessions_copy" (like "sessions")`);
      await tx.execute(
        sql`insert into "sessions_copy" (id, user_id, expires_at) values (${raw}, ${who.id}, now())`,
      );
      await tx.execute(sql.raw(statement.replaceAll('"sessions"', '"sessions_copy"')));
      const read = await tx.execute<{ id: string }>(sql`select id from "sessions_copy"`);
      await tx.execute(sql`drop table "sessions_copy"`);
      return read.rows;
    });
    expect(rows).toEqual([{ id: sessionDigest(raw) }]);
  });
});
