import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two routes that may email a link, driven with mail off, on and failing.
 *
 * The end-to-end test can run only one half on CI, because the server's
 * environment decides mail and CI starts the server with it on. This runs
 * both: what an answer carries, and that the write is over before the send
 * starts, so a send that fails takes nothing back.
 */
const fake = vi.hoisted(() => {
  /** What happened, in order: the writes and the send share one list. */
  const steps: string[] = [];
  /** The rows each `select … limit` answers, one list per call, in order. */
  let selects: unknown[][] = [];
  const chain = (rows: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["from", "innerJoin", "where", "limit", "values", "returning"]) {
      builder[name] = () => builder;
    }
    builder.then = (ok: (rows: unknown[]) => unknown) => Promise.resolve(rows()).then(ok);
    return builder;
  };
  return {
    steps,
    /** Who calls; the limit test takes a fresh one. */
    actor: "owner-1",
    answer(...lists: unknown[][]) {
      selects = lists;
    },
    db: {
      select: () => chain(() => selects.shift() ?? []),
      insert: () =>
        chain(() => {
          steps.push("insert");
          return [{ email: "new@example.com", createdAt: new Date("2026-09-28T10:00:00Z") }];
        }),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/queries", () => ({
  logActivity: vi.fn(async () => fake.steps.push("activity")),
  projectName: vi.fn(async () => "Launch"),
}));
vi.mock("@/lib/resets", () => ({
  makeResetToken: vi.fn(async () => {
    fake.steps.push("token");
    return "ushr_abc";
  }),
}));
vi.mock("@/lib/mail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/mail")>();
  return { ...real, sendMail: vi.fn() };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    guard: vi.fn(async () => ({
      user: { id: fake.actor, name: "Ada Owner", kind: "human" },
      membership: { role: "owner" },
    })),
    broadcast: vi.fn(),
  };
});

const { sendMail } = await import("@/lib/mail");
const invites = await import("@/app/api/projects/[projectId]/members/route");
const resets = await import("@/app/api/projects/[projectId]/members/[userId]/reset/route");

const PROJECT = "7f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const MEMBER = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
let caller = 0;

/** A request from its own address, so the mail limit never joins in. */
function request(path: string, body?: unknown, address?: string) {
  caller += 1;
  return new Request(`http://10.0.0.5:3000${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "board.example.com",
      "x-forwarded-proto": "https",
      "x-forwarded-for": address ?? `192.0.2.${caller}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function invite(address?: string) {
  // No account uses the email, and it is not invited yet.
  fake.answer([], []);
  const res = await invites.POST(
    request(`/api/projects/${PROJECT}/members`, { email: "new@example.com" }, address),
    {
      params: Promise.resolve({ projectId: PROJECT }),
    },
  );
  return { status: res.status, body: await res.json() };
}

async function reset() {
  fake.answer([
    { id: MEMBER, name: "Bo Member", email: "bo@example.com", kind: "human", role: "member" },
  ]);
  const res = await resets.POST(request(`/api/projects/${PROJECT}/members/${MEMBER}/reset`), {
    params: Promise.resolve({ projectId: PROJECT, userId: MEMBER }),
  });
  return { status: res.status, body: await res.json() };
}

const send = vi.mocked(sendMail);

beforeEach(() => {
  fake.steps.length = 0;
  send.mockReset();
  send.mockImplementation(async () => {
    fake.steps.push("send");
    return true;
  });
});
afterEach(() => vi.unstubAllEnvs());

function mail(on: boolean) {
  vi.stubEnv("SMTP_URL", on ? "smtp://127.0.0.1:2525" : "");
  vi.stubEnv("MAIL_FROM", on ? "board@example.com" : "");
}

describe("with no SMTP_URL", () => {
  it("an invite answers as before, with emailed: false, and sends nothing", async () => {
    mail(false);
    const answer = await invite();
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      invite: { email: "new@example.com", createdAt: "2026-09-28T10:00:00.000Z" },
      emailed: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("a reset link answers as before, with emailed: false, and sends nothing", async () => {
    mail(false);
    const answer = await reset();
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      link: "https://board.example.com/reset/ushr_abc",
      emailed: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("with mail on", () => {
  it("an invite is written, then emailed with the route's own origin", async () => {
    mail(true);
    const answer = await invite();
    expect(answer.body.emailed).toBe(true);
    expect(fake.steps).toEqual(["insert", "send"]);
    const [letter] = send.mock.calls[0];
    expect(letter.to).toBe("new@example.com");
    expect(letter.text).toContain("https://board.example.com/register");
    expect(letter.text).toContain("Ada Owner invited you to the project Launch");
  });

  it("a reset link is written, then emailed to the member, and is the answered link", async () => {
    mail(true);
    const answer = await reset();
    expect(answer.body).toEqual({
      link: "https://board.example.com/reset/ushr_abc",
      emailed: true,
    });
    expect(fake.steps).toEqual(["token", "activity", "send"]);
    const [letter] = send.mock.calls[0];
    expect(letter.to).toBe("bo@example.com");
    expect(letter.text).toContain("\nhttps://board.example.com/reset/ushr_abc\n");
  });

  it("a send that fails answers emailed: false, and keeps the invite and the link", async () => {
    mail(true);
    send.mockImplementation(async () => {
      fake.steps.push("send");
      return false;
    });

    const invited = await invite();
    expect(invited.status).toBe(201);
    expect(invited.body.invite.email).toBe("new@example.com");
    expect(invited.body.emailed).toBe(false);

    const made = await reset();
    expect(made.status).toBe(201);
    expect(made.body).toEqual({ link: "https://board.example.com/reset/ushr_abc", emailed: false });
    expect(fake.steps).toEqual(["insert", "send", "token", "activity", "send"]);
  });

  it("stops sending after ten from one caller, and still writes the invite", async () => {
    mail(true);
    fake.actor = "owner-limit";
    for (let i = 0; i < 10; i += 1) expect((await invite("203.0.113.77")).body.emailed).toBe(true);
    const refused = await invite("203.0.113.77");
    expect(refused.status).toBe(201);
    expect(refused.body.invite.email).toBe("new@example.com");
    expect(refused.body.emailed).toBe(false);
    expect(send).toHaveBeenCalledTimes(10);
  });
});
