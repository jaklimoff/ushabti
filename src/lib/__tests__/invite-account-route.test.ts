import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { db } = await import("@/db");
const { projectInvites, projectMembers, users } = await import("@/db/schema");
const { hashPassword } = await import("@/lib/auth");
const { api, board, call, join, ok, person, project, unique } = await import("@/test/route");

/*
 * Adding an email that has an account writes an invite, exactly as one with
 * none does, and the account joins only by opening the link signed in as that
 * email. The answer never says whether an email is registered.
 */

type Who = Awaited<ReturnType<typeof person>>;

async function emailOf(who: Who) {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, who.id));
  return row.email!;
}

async function memberRole(projectId: string, who: Who) {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, who.id)));
  return row?.role ?? null;
}

async function invite(owner: Who, projectId: string, email: string, role = "member") {
  const res = await api(owner).post(`/api/projects/${projectId}/members`, { email, role });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const tokenOf = (link: unknown) => String(link).split("/invite/")[1];

describe("An invite to an email that has an account", () => {
  it("answers the same shape as one to a new email, and names no account", async () => {
    const owner = await person("Shape Owner");
    const guest = await person("Shape Guest");
    const p = await project(owner);

    const known = await invite(owner, p.id, await emailOf(guest));
    const fresh = await invite(owner, p.id, `${unique("fresh").replace(" ", "-")}@example.com`);

    expect(known.status).toBe(201);
    expect(fresh.status).toBe(201);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(Object.keys(known.body).sort()).toEqual(["emailed", "invite", "link"]);
    expect(Object.keys(known.body.invite as object).sort()).toEqual(
      Object.keys(fresh.body.invite as object).sort(),
    );
    expect(JSON.stringify(known.body)).not.toContain(guest.id);
    expect(JSON.stringify(known.body)).not.toContain("Shape Guest");

    // Nobody is in yet, and People lists it as an invite.
    expect(await memberRole(p.id, guest)).toBeNull();
    const read = await board(owner, p.id);
    const invites = (read.invites as { email: string }[]).map((i) => i.email);
    expect(invites).toContain(await emailOf(guest));
  });

  it("joins only when the invited account presses join, once, with the invite's role", async () => {
    const owner = await person("Join Owner");
    const guest = await person("Join Guest");
    const other = await person("Join Other");
    const p = await project(owner);
    const { body } = await invite(owner, p.id, await emailOf(guest), "admin");
    const token = tokenOf(body.link);

    // Another account opens it: it says whom it is for and joins nothing.
    const refused = await api(other).post("/api/invites/accept", { token });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe(
      `This invite is for ${await emailOf(guest)}. Sign in with that email to join.`,
    );
    expect(await memberRole(p.id, other)).toBeNull();
    expect(await memberRole(p.id, guest)).toBeNull();

    // Signed out, the button does nothing at all.
    expect((await call(null, "POST", "/api/invites/accept", { token })).status).toBe(401);

    const joined = await ok<{ joined: string }>(api(guest).post("/api/invites/accept", { token }));
    expect(joined.joined).toBe(p.id);
    expect(await memberRole(p.id, guest)).toBe("admin");

    // The link is spent.
    const again = await api(guest).post("/api/invites/accept", { token });
    expect(again.status).toBe(400);
    const left = await db.select().from(projectInvites).where(eq(projectInvites.projectId, p.id));
    expect(left).toEqual([]);
  });

  it("signs in from the link and joins in the same press", async () => {
    const owner = await person("Login Owner");
    const guest = await person("Login Guest");
    const p = await project(owner);
    const email = await emailOf(guest);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword("password-123") })
      .where(eq(users.id, guest.id));
    const { body } = await invite(owner, p.id, email);

    const wrong = await call(null, "POST", "/api/auth/login", {
      email,
      password: "nope-nope-nope",
      invite: tokenOf(body.link),
    });
    expect(wrong.status).toBe(401);
    expect(await memberRole(p.id, guest)).toBeNull();

    const signed = await ok<{ joined: string }>(
      call(null, "POST", "/api/auth/login", {
        email,
        password: "password-123",
        invite: tokenOf(body.link),
      }),
    );
    expect(signed.joined).toBe(p.id);
    expect(await memberRole(p.id, guest)).toBe("member");
  });

  it("charges a refused token at sign in to the sign-up key, so a password walks no tokens", async () => {
    const guest = await person("Walker");
    const email = await emailOf(guest);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword("password-123") })
      .where(eq(users.id, guest.id));
    const from = { id: "", name: "", headers: { "x-forwarded-for": "203.0.113.77" } };
    const statuses: number[] = [];
    for (let i = 0; i < 30 && !statuses.includes(429); i += 1) {
      const res = await call(from, "POST", "/api/auth/login", {
        email,
        password: "password-123",
        invite: `ushi_walked-${i}`,
      });
      statuses.push(res.status);
    }
    expect(statuses[0]).toBe(400);
    expect(statuses.at(-1)).toBe(429);
    // The same address is refused at the invite page's key too.
    const accept = await call(
      { ...from, headers: { ...from.headers, ...guest.headers } },
      "POST",
      "/api/invites/accept",
      { token: "ushi_one-more" },
    );
    expect(accept.status).toBe(429);
  });

  it("can be withdrawn, and then opens nothing", async () => {
    const owner = await person("Withdraw Owner");
    const guest = await person("Withdraw Guest");
    const p = await project(owner);
    const email = await emailOf(guest);
    const { body } = await invite(owner, p.id, email);
    await ok(api(owner).del(`/api/projects/${p.id}/invites/${encodeURIComponent(email)}`));
    const res = await api(guest).post("/api/invites/accept", { token: tokenOf(body.link) });
    expect(res.status).toBe(400);
    expect(await memberRole(p.id, guest)).toBeNull();
  });

  it("still answers 409 for somebody already a member, and writes no invite", async () => {
    const owner = await person("Member Owner");
    const member = await person("Member Already");
    const p = await project(owner);
    await join(p.id, member, "member");
    const answer = await invite(owner, p.id, (await emailOf(member)).toUpperCase());
    expect(answer.status).toBe(409);
    expect(answer.body.error).toBe("That person is already a member.");
    const written = await db
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.projectId, p.id));
    expect(written).toEqual([]);
  });
});
