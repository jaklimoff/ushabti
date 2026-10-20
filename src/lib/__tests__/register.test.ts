import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-up writes the account and, from an invite link, its one membership.
 * The test hands the route a database of arrays, with a transaction that puts
 * them back when it throws. A write through `db` while that transaction is
 * open throws, because the rollback would otherwise hide a write that a real
 * database keeps. The invite itself is `@/lib/invites`, faked here, and
 * proved against Postgres by `e2e/invite.spec.ts`.
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const NAME = Symbol.for("drizzle:Name");
  let tables: Record<string, Row[]> = {};
  let failMembers = false;
  let inTransaction = false;
  const rows = (table: unknown) => (tables[(table as Record<symbol, string>)[NAME]] ??= []);
  const pick = (list: Row[], shape?: Record<string, unknown>) =>
    shape ? list.map((r) => Object.fromEntries(Object.keys(shape).map((k) => [k, r[k]]))) : list;

  function handle(outer: boolean) {
    const refuse = () => {
      if (outer && inTransaction) throw new Error("a write went past the transaction");
    };
    return {
      // The lock `joinProject` takes on the person's list.
      execute: () => Promise.resolve(),
      select: (shape: Record<string, unknown>) => ({
        from: (table: unknown) => ({
          where: () => {
            const found = pick(rows(table), shape);
            const limit = (n: number) => Promise.resolve(found.slice(0, n));
            return Object.assign(Promise.resolve(found), {
              limit,
              orderBy: () => ({ limit }),
            });
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (value: Row | Row[]) => {
          refuse();
          const list = Array.isArray(value) ? value : [value];
          if ((table as Record<symbol, string>)[NAME] === "project_members" && failMembers) {
            return Promise.reject(new Error("the member insert failed"));
          }
          const made = list.map((r) => ({ id: `id-${rows(table).length + 1}`, ...r }));
          rows(table).push(...made);
          return Object.assign(Promise.resolve(made), {
            returning: (shape?: Record<string, unknown>) => Promise.resolve(pick(made, shape)),
          });
        },
      }),
      delete: (table: unknown) => ({
        where: () => {
          refuse();
          const gone = rows(table).splice(0);
          return Object.assign(Promise.resolve(gone), {
            returning: (shape?: Record<string, unknown>) => Promise.resolve(pick(gone, shape)),
          });
        },
      }),
    };
  }

  const db = {
    ...handle(true),
    transaction: async <T>(fn: (tx: ReturnType<typeof handle>) => Promise<T>) => {
      const saved = structuredClone(tables);
      inTransaction = true;
      try {
        return await fn(handle(false));
      } catch (err) {
        tables = saved;
        throw err;
      } finally {
        inTransaction = false;
      }
    },
  };

  return {
    db,
    rows: (name: string) => (tables[name] ??= []),
    reset: () => {
      tables = {};
      failMembers = false;
      inTransaction = false;
    },
    failMembers: (on: boolean) => {
      failMembers = on;
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    createSession: vi.fn(async () => {}),
    hashPassword: vi.fn(async () => "hash"),
  };
});
vi.mock("@/lib/invites", () => ({
  inviteOfToken: vi.fn(),
  spendInvite: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, broadcast: vi.fn(async () => {}) };
});

const { POST } = await import("@/app/api/auth/register/route");
const { createSession } = await import("@/lib/auth");
const { broadcast } = await import("@/lib/api");
const { inviteOfToken, spendInvite } = await import("@/lib/invites");
const { INVITE_IS_DEAD } = await import("@/lib/invite-link");

const EMAIL = "ada@example.com";

const LINK = "ushi_the-token";
const INVITE = { projectId: "project-1", email: EMAIL, project: "Launch" };

async function signUp(extra: Record<string, unknown> = {}) {
  const req = new Request("http://board/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${++caller}` },
    body: JSON.stringify({ email: EMAIL, password: "long enough", name: "Ada", ...extra }),
  });
  // The route takes no params; the wrapper still asks for a context.
  const res = await POST(req, undefined);
  return { status: res.status, body: await res.json() };
}
let caller = 0;

beforeEach(() => {
  fake.reset();
  vi.unstubAllEnvs();
  vi.mocked(createSession).mockClear();
  vi.mocked(broadcast).mockClear();
  vi.mocked(inviteOfToken).mockReset();
  vi.mocked(spendInvite).mockReset();
  // A live link for EMAIL, until a test says otherwise.
  vi.mocked(inviteOfToken).mockResolvedValue(INVITE);
  vi.mocked(spendInvite).mockResolvedValue({ projectId: "project-1", role: "member" });
});

describe("sign-up", () => {
  it("joins the project of the link, and spends it in the same transaction", async () => {
    const res = await signUp({ invite: LINK });
    expect(res.status).toBe(200);
    const [user] = fake.rows("users");
    expect(fake.rows("project_members").map((m) => [m.projectId, m.userId, m.role])).toEqual([
      ["project-1", user.id, "member"],
    ]);
    expect(spendInvite).toHaveBeenCalledWith(expect.anything(), LINK, EMAIL);
    expect(vi.mocked(broadcast).mock.calls.map(([e]) => e.projectId)).toEqual(["project-1"]);
    expect(createSession).toHaveBeenCalledWith(user.id);
  });

  it("joins with the role the invite carries", async () => {
    vi.mocked(spendInvite).mockResolvedValue({ projectId: "project-1", role: "admin" });
    const res = await signUp({ invite: LINK });
    expect(res.status).toBe(200);
    expect(fake.rows("project_members").map((m) => m.role)).toEqual(["admin"]);
  });

  it("with sign-up open, an account made without the link joins no project", async () => {
    const res = await signUp();
    expect(res.status).toBe(200);
    expect(fake.rows("users")).toHaveLength(1);
    expect(fake.rows("project_members")).toEqual([]);
    expect(inviteOfToken).not.toHaveBeenCalled();
    expect(spendInvite).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("with sign-up closed, an invited email without the link is refused, as any email", async () => {
    vi.stubEnv("USHABTI_SIGNUP", "closed");
    const res = await signUp();
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("This board is not taking new accounts.");
    expect(fake.rows("users")).toEqual([]);
    expect(inviteOfToken).not.toHaveBeenCalled();
  });

  it("with sign-up closed, the link still lets its email in", async () => {
    vi.stubEnv("USHABTI_SIGNUP", "closed");
    const res = await signUp({ invite: LINK });
    expect(res.status).toBe(200);
    expect(fake.rows("project_members")).toHaveLength(1);
  });

  it("a dead link is refused with the sentence that asks for a new invite", async () => {
    vi.mocked(inviteOfToken).mockResolvedValue(null);
    const res = await signUp({ invite: LINK });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVITE_IS_DEAD);
    expect(INVITE_IS_DEAD).toContain("Ask the person who invited you for a new invite.");
    expect(fake.rows("users")).toEqual([]);
  });

  it("the link takes only the email it was sent to", async () => {
    const res = await signUp({ invite: LINK, email: "someone@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`This invite is for ${EMAIL}. Sign up with that email.`);
    expect(fake.rows("users")).toEqual([]);
  });

  it("a link spent by another browser in between leaves no account", async () => {
    vi.mocked(spendInvite).mockResolvedValue(null);
    const res = await signUp({ invite: LINK });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(INVITE_IS_DEAD);
    expect(fake.rows("users")).toEqual([]);
    expect(fake.rows("project_members")).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("leaves no account when the member insert fails, and the link can sign up again", async () => {
    fake.failMembers(true);

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await signUp({ invite: LINK });
    quiet.mockRestore();
    expect(failed.status).toBe(500);
    expect(fake.rows("users")).toEqual([]);
    expect(fake.rows("project_members")).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    fake.failMembers(false);
    const again = await signUp({ invite: LINK });
    expect(again.status).toBe(200);
    expect(fake.rows("users")).toHaveLength(1);
    expect(fake.rows("project_members")).toHaveLength(1);
  });
});
