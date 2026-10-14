import { describe, expect, it, vi } from "vitest";
import type { Caller } from "@/test/route";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { eq, sql } = await import("drizzle-orm");
const { db } = await import("@/db");
const { passwordResets, users } = await import("@/db/schema");
const { hashPassword } = await import("@/lib/auth");
const { api, board, join, ok, person, project } = await import("@/test/route");

/*
 * An account's own routes: what `/api/auth/me` and `/api/auth/password` keep
 * and refuse, the limit on sign-in, and the rows a reset link leaves. One
 * file, because each file boots its own database. Each test was a test, or
 * the server half of one, of `e2e/account.spec.ts`, `e2e/rate-limit.spec.ts`
 * or `e2e/reset.spec.ts`, and names it. The faces and the boxes are
 * `Account.test.tsx`; the walk through the menu and the reset link that works
 * once and signs in stayed end to end.
 */

type Member = { id: string; emoji: string | null };

describe("Your own account", () => {
  // The server half of "a face set through the API and not on the grid still shows as picked".
  it("a face set through the API is kept, and words are refused", async () => {
    const grace = await person("Grace Hopper");
    const pair = "🧑🏿‍🤝‍🧑🏻";
    await ok(api(grace).patch("/api/auth/me", { emoji: pair }));
    expect((await api(grace).patch("/api/auth/me", { emoji: "GH" })).status).toBe(400);
    const [row] = await db
      .select({ emoji: users.avatarEmoji })
      .from(users)
      .where(eq(users.id, grace.id));
    expect(row.emoji).toBe(pair);
  });

  // The server half of "a face can be an emoji, and Initials brings the initials back".
  it("the board carries the face, and Initials takes it away", async () => {
    const ada = await person("Ada Lovelace");
    const p = await project(ada);
    const face = async () =>
      ((await board(ada, p.id)).members as Member[]).find((m) => m.id === ada.id)!.emoji;

    expect(await face()).toBeNull();
    await ok(api(ada).patch("/api/auth/me", { emoji: "🦊" }));
    expect(await face()).toBe("🦊");
    await ok(api(ada).patch("/api/auth/me", { emoji: null }));
    expect(await face()).toBeNull();
  });

  // The server half of "the password needs the old one, and says so when it is wrong".
  it("the password needs the old one, and says so when it is wrong", async () => {
    const careful = await person("Careful Person");
    await db
      .update(users)
      .set({ passwordHash: await hashPassword("ushabti-secret") })
      .where(eq(users.id, careful.id));

    const wrong = await api(careful).post("/api/auth/password", {
      current: "not-the-password",
      next: "a-longer-secret",
    });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toBe("That is not the password you use now.");

    await ok(
      api(careful).post("/api/auth/password", {
        current: "ushabti-secret",
        next: "a-longer-secret",
      }),
    );
  });
});

// Was e2e/rate-limit.spec.ts. The counting itself is `rate-limit.test.ts`.
describe("A guessing attack", () => {
  it("is refused after ten wrong passwords, and the form says how long to wait", async () => {
    // The limiter counts per address, which is whatever the proxy says.
    const from = api({ id: "", name: "", headers: { "x-forwarded-for": "198.51.100.7" } });
    // An email nobody registered fails the same way a real one does.
    const email = "guess@example.com";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const wrong = await from.post("/api/auth/login", { email, password: `guess-${attempt}` });
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error).toBe("Wrong email or password.");
    }

    // The eleventh never reaches the password.
    const refused = await from.post("/api/auth/login", { email, password: "guess-11" });
    expect(refused.status).toBe(429);
    // Whole seconds, and what is left of the ten minutes.
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    // Ten minutes and not nine: the sentence rounds what is left up.
    expect((await refused.json()).error).toBe("Too many tries. Wait 10 minutes and try again.");
  });
});

/** An owner, and a member who forgot their password. */
async function forgot(name: string) {
  const owner = await person("Owner Person");
  const member = await person(name);
  const p = await project(owner);
  await join(p.id, member, "member");
  /** Presses Reset password on the member's row, and answers the link. */
  const makeLink = async () =>
    (
      await ok<{ link: string }>(
        api(owner).post(`/api/projects/${p.id}/members/${member.id}/reset`, {}),
      )
    ).link;
  return { owner, member, project: p, makeLink };
}

/** How many link rows this account still has. */
async function linkRows(who: Caller): Promise<number> {
  return (await db.select().from(passwordResets).where(eq(passwordResets.userId, who.id))).length;
}

/** Moves this account's links back, so their day is over. */
async function ageLinks(who: Caller, hours: number): Promise<void> {
  await db.execute(sql`
    update password_resets
       set created_at = now() - (${String(hours)} || ' hours')::interval,
           expires_at = now() - (${String(hours)} || ' hours')::interval + interval '24 hours'
     where user_id = ${who.id}`);
}

type FeedEntry = {
  kind: string;
  taskId: string | null;
  taskKey: string | null;
  data: { forUserId?: string; forName?: string };
  actor: { name: string; kind: string } | null;
};

describe("A forgotten password", () => {
  it("a spent link and an old one go when the next one is made", async () => {
    // One row arrives per link. The sweep is on the write, so this watches the table.
    const { member, makeLink } = await forgot("Grace Hopper");
    await makeLink();
    expect(await linkRows(member)).toBe(1);

    // Older than its day. Nothing reads it away, so it waits for the next link.
    await ageLinks(member, 25);
    const second = await makeLink();
    expect(await linkRows(member)).toBe(1);

    // A spent link goes the same way.
    await ok(
      api(null).post("/api/auth/reset", {
        token: second.split("/reset/")[1],
        password: "a-third-secret",
      }),
    );
    await makeLink();
    expect(await linkRows(member)).toBe(1);
  });

  it("the feed keeps the record of a link after the sweep takes the row", async () => {
    const { member, project: p, makeLink } = await forgot("Ada Lovelace");
    const { now } = await ok<{ now: string }>(api(member).get(`/api/projects/${p.id}/activity`));

    await makeLink();
    // Older than its day, so the next link sweeps the first row away.
    await ageLinks(member, 25);
    await makeLink();
    expect(await linkRows(member)).toBe(1);

    /* Read as the member and not as the owner: this is visible to everybody
       in the project, exactly as adding a member is. */
    const { entries } = await ok<{ entries: FeedEntry[] }>(
      api(member).get(`/api/projects/${p.id}/activity?after=${encodeURIComponent(now)}`),
    );
    const lines = entries.filter((e) => e.kind === "reset");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      // On the project and on no task: a link is about an account.
      expect(line.taskId).toBeNull();
      expect(line.taskKey).toBeNull();
      expect(line.actor).toMatchObject({ name: "Owner Person", kind: "human" });
      expect(line.data.forName).toBe("Ada Lovelace");
      expect(line.data.forUserId).toBe(member.id);
    }
  });
});
