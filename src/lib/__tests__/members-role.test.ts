import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The role an invite carries: written on the invite of somebody with no
 * account, given at once to somebody with one, and refused with the role
 * rule's own sentence when the inviter may not give it.
 */
const fake = vi.hoisted(() => {
  let selects: unknown[][] = [];
  const written: Record<string, unknown>[] = [];
  const chain = (rows: () => unknown[], onValues?: (v: Record<string, unknown>) => void) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["from", "innerJoin", "where", "limit", "onConflictDoUpdate", "returning"]) {
      builder[name] = () => builder;
    }
    builder.values = (v: Record<string, unknown>) => {
      onValues?.(v);
      return builder;
    };
    builder.then = (ok: (rows: unknown[]) => unknown) => Promise.resolve(rows()).then(ok);
    return builder;
  };
  return {
    role: "owner",
    written,
    answer(...lists: unknown[][]) {
      selects = lists;
    },
    db: {
      select: () => chain(() => selects.shift() ?? []),
      insert: () => {
        let row: Record<string, unknown> = {};
        return chain(
          () => [{ ...row, createdAt: new Date("2026-10-20T10:00:00Z") }],
          (v) => {
            row = v;
            written.push(v);
          },
        );
      },
      transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/queries", () => ({ projectName: vi.fn(async () => "Launch") }));
vi.mock("@/lib/membership", () => ({
  joinProject: vi.fn(async (_tx: unknown, row: Record<string, unknown>) => fake.written.push(row)),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    guard: vi.fn(async () => ({
      user: { id: "actor-1", name: "Ada", kind: "human" },
      membership: { role: fake.role },
    })),
    broadcast: vi.fn(),
  };
});

const invites = await import("@/app/api/projects/[projectId]/members/route");

const PROJECT = "7f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";

async function invite(body: Record<string, unknown>, account?: Record<string, unknown>) {
  // The account the email names, if any, then no membership for it yet.
  fake.answer(account ? [account] : [], []);
  const res = await invites.POST(
    new Request(`http://localhost/api/projects/${PROJECT}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: PROJECT }) },
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  fake.role = "owner";
  fake.written.length = 0;
});

describe("an invite with a role", () => {
  it("is a member's when it names none", async () => {
    const answer = await invite({ email: "new@example.com" });
    expect(answer.status).toBe(201);
    expect(fake.written[0].role).toBe("member");
    expect(answer.body.invite.role).toBe("member");
  });

  it("an admin invites an admin, and the link carries the role", async () => {
    fake.role = "admin";
    const answer = await invite({ email: "new@example.com", role: "admin" });
    expect(answer.status).toBe(201);
    expect(fake.written[0].role).toBe("admin");
    expect(answer.body.invite.role).toBe("admin");
  });

  it("somebody with an account joins as an admin at once", async () => {
    const answer = await invite(
      { email: "bo@example.com", role: "admin" },
      { id: "bo", name: "Bo", email: "bo@example.com", color: "#000", avatarEmoji: null },
    );
    expect(answer.status).toBe(201);
    expect(fake.written).toEqual([{ projectId: PROJECT, userId: "bo", role: "admin" }]);
    expect(answer.body.member.role).toBe("admin");
  });

  it("an admin may not invite an owner, with the role rule's sentence", async () => {
    fake.role = "admin";
    const answer = await invite({ email: "new@example.com", role: "owner" });
    expect(answer.status).toBe(403);
    expect(answer.body.error).toBe("Only the owner can hand the project over.");
    expect(fake.written).toEqual([]);
  });

  it("the owner may not invite an owner either: the project is handed over", async () => {
    const answer = await invite({ email: "new@example.com", role: "owner" });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("An invite is for a member or an admin.");
    expect(fake.written).toEqual([]);
  });

  it("a word that is no role is refused as a role change refuses it", async () => {
    const answer = await invite({ email: "new@example.com", role: "boss" });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("A role is owner, admin or member.");
    expect(fake.written).toEqual([]);
  });

  it("a member may not invite at all", async () => {
    fake.role = "member";
    const answer = await invite({ email: "new@example.com", role: "admin" });
    expect(answer.status).toBe(403);
    expect(fake.written).toEqual([]);
  });
});
