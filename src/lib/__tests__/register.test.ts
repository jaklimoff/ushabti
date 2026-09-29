import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-up writes three things: the account, its memberships and the spent
 * invites. The test hands the route a database of three arrays for one email,
 * with a transaction that puts them back when it throws. A write through
 * `db` while that transaction is open throws, because the rollback would
 * otherwise hide a write that a real database keeps.
 */
const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const NAME = Symbol.for("drizzle:Name");
  let tables: Record<string, Row[]> = {};
  let failMembers = false;
  let afterInviteRead: (() => void) | null = null;
  let inTransaction = false;
  const rows = (table: unknown) => (tables[(table as Record<symbol, string>)[NAME]] ??= []);
  const pick = (list: Row[], shape?: Record<string, unknown>) =>
    shape ? list.map((r) => Object.fromEntries(Object.keys(shape).map((k) => [k, r[k]]))) : list;

  function handle(outer: boolean) {
    const refuse = () => {
      if (outer && inTransaction) throw new Error("a write went past the transaction");
    };
    return {
      select: (shape: Record<string, unknown>) => ({
        from: (table: unknown) => ({
          where: () => {
            const found = pick(rows(table), shape);
            if ((table as Record<symbol, string>)[NAME] === "project_invites") {
              afterInviteRead?.();
            }
            return Object.assign(Promise.resolve(found), {
              limit: (n: number) => Promise.resolve(found.slice(0, n)),
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
      afterInviteRead = null;
      inTransaction = false;
    },
    failMembers: (on: boolean) => {
      failMembers = on;
    },
    afterInviteRead: (fn: () => void) => {
      afterInviteRead = fn;
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
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, broadcast: vi.fn(async () => {}) };
});

const { POST } = await import("@/app/api/auth/register/route");
const { createSession } = await import("@/lib/auth");
const { broadcast } = await import("@/lib/api");

const EMAIL = "ada@example.com";

async function signUp() {
  const req = new Request("http://board/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: "long enough", name: "Ada" }),
  });
  // The route takes no params; the wrapper still asks for a context.
  const res = await POST(req, undefined);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  fake.reset();
  vi.mocked(createSession).mockClear();
  vi.mocked(broadcast).mockClear();
});

describe("sign-up", () => {
  it("leaves no account when the member insert fails, and the email can sign up again", async () => {
    fake.rows("project_invites").push({ projectId: "project-1", email: EMAIL });
    fake.failMembers(true);

    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await signUp();
    quiet.mockRestore();
    expect(failed.status).toBe(500);
    expect(fake.rows("users")).toEqual([]);
    expect(fake.rows("project_members")).toEqual([]);
    expect(fake.rows("project_invites")).toHaveLength(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    fake.failMembers(false);
    const again = await signUp();
    expect(again.status).toBe(200);
    expect(fake.rows("users")).toHaveLength(1);
    expect(fake.rows("project_members")).toHaveLength(1);
  });

  it("joins every project that invited the email, and no invite is left", async () => {
    fake.rows("project_invites").push({ projectId: "project-1", email: EMAIL });
    // An invite that lands between the read and the delete.
    fake.afterInviteRead(() => {
      fake.afterInviteRead(() => {});
      fake.rows("project_invites").push({ projectId: "project-2", email: EMAIL });
    });

    const res = await signUp();
    expect(res.status).toBe(200);
    const [user] = fake.rows("users");
    expect(
      fake
        .rows("project_members")
        .map((m) => [m.projectId, m.userId, m.role])
        .sort(),
    ).toEqual([
      ["project-1", user.id, "member"],
      ["project-2", user.id, "member"],
    ]);
    expect(fake.rows("project_invites")).toEqual([]);
    expect(
      vi
        .mocked(broadcast)
        .mock.calls.map(([e]) => e.projectId)
        .sort(),
    ).toEqual(["project-1", "project-2"]);
    expect(createSession).toHaveBeenCalledWith(user.id);
  });
});
