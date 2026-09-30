import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/auth/forgot`, driven with the database, the token and the send
 * faked, so every answer and every key can be read.
 *
 * The route answers before it looks anything up: the work is handed to
 * `after()`, which this test holds until it chooses to run it. So the time
 * to answer cannot say whether an account exists, and the test sees that no
 * select happened before the answer.
 */
const fake = vi.hoisted(() => {
  const steps: string[] = [];
  let rows: unknown[] = [];
  const later: Array<() => unknown> = [];
  const chain = () => {
    const builder: Record<string, unknown> = {};
    for (const name of ["from", "where", "limit"]) builder[name] = () => builder;
    builder.then = (ok: (rows: unknown[]) => unknown) => {
      steps.push("select");
      return Promise.resolve(rows).then(ok);
    };
    return builder;
  };
  return {
    steps,
    later,
    account(row: unknown | null) {
      rows = row ? [row] : [];
    },
    db: { select: () => chain() },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (work: () => unknown) => fake.later.push(work) };
});
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

const { sendMail } = await import("@/lib/mail");
const { makeResetToken } = await import("@/lib/resets");
const { limiter, forgotByAddress, forgotByEmail, tooManyMessage, WINDOW_MS } =
  await import("@/lib/rate-limit");
const { FORGOT_OFF, FORGOT_SENT } = await import("@/lib/reset-link");
const forgot = await import("@/app/api/auth/forgot/route");

const send = vi.mocked(sendMail);
const token = vi.mocked(makeResetToken);
let caller = 0;

/** A request with a forged `Host`, from an address of its own unless one is named. */
function ask(email: unknown, address?: string) {
  caller += 1;
  return forgot.POST(
    new Request("http://10.0.0.5:3000/api/auth/forgot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "evil.example.net",
        "x-forwarded-host": "evil.example.net",
        "x-forwarded-proto": "https",
        "x-forwarded-for": address ?? `192.0.2.${caller}`,
      },
      body: JSON.stringify({ email }),
    }),
    undefined,
  );
}

/** Runs what the route left for after its answer. */
async function drain() {
  while (fake.later.length) await fake.later.shift()!();
}

const ADA = {
  id: "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
  name: "Ada Lovelace",
  email: "ada@example.com",
  kind: "human",
  passwordHash: "scrypt$x",
};

beforeEach(() => {
  fake.steps.length = 0;
  fake.later.length = 0;
  send.mockReset();
  send.mockImplementation(async () => {
    fake.steps.push("send");
    return true;
  });
  token.mockClear();
  vi.stubEnv("SMTP_URL", "smtp://127.0.0.1:2525");
  vi.stubEnv("MAIL_FROM", "board@example.com");
  vi.stubEnv("USHABTI_URL", "https://tasks.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/forgot", () => {
  it("emails a link built from USHABTI_URL, never from a forged Host", async () => {
    fake.account(ADA);
    const res = await ask(" Ada@Example.com ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: FORGOT_SENT });

    // Nothing was looked up before the answer went out.
    expect(fake.steps).toEqual([]);
    await drain();

    expect(fake.steps).toEqual(["select", "token", "send"]);
    expect(token).toHaveBeenCalledWith(ADA.id, null);
    const [letter] = send.mock.calls[0];
    expect(letter.to).toBe("ada@example.com");
    expect(letter.text).toContain("\nhttps://tasks.example.com/reset/ushr_abc\n");
    expect(letter.text).not.toContain("evil.example.net");
  });

  it("answers the same sentence for an unknown email, and makes no token and sends nothing", async () => {
    fake.account(null);
    const res = await ask("nobody@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: FORGOT_SENT });
    await drain();
    expect(fake.steps).toEqual(["select"]);
    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("makes no token and sends nothing for an agent, or for a person with no password", async () => {
    fake.account({ ...ADA, kind: "agent", passwordHash: null });
    expect(await (await ask("agent@example.com")).json()).toEqual({
      ok: true,
      message: FORGOT_SENT,
    });
    await drain();

    fake.account({ ...ADA, passwordHash: null });
    expect(await (await ask("ada@example.com")).json()).toEqual({ ok: true, message: FORGOT_SENT });
    await drain();

    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("is refused with the ask-an-admin sentence while mail or USHABTI_URL is missing", async () => {
    vi.stubEnv("USHABTI_URL", "");
    const res = await ask("ada@example.com");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: FORGOT_OFF });
    expect(fake.later).toHaveLength(0);
  });
});

describe("the forgot limit", () => {
  it("names the address and the typed email, lowercased, and nothing about an account", () => {
    expect(forgotByAddress("203.0.113.9")).toBe("forgot:ip:203.0.113.9");
    expect(forgotByEmail("ada@example.com")).toBe("forgot:email:ada@example.com");
  });

  it("refuses an email over 200 characters before it becomes a key", async () => {
    const long = `${"a".repeat(190)}@example.com`;
    const before = limiter.size();
    const res = await ask(long);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Email is too long (max 200 characters)." });
    expect(limiter.size()).toBe(before);
    expect(limiter.waitMs(forgotByEmail(long))).toBe(0);
    expect(fake.later).toHaveLength(0);
  });

  it("counts one address across emails, real and unknown alike, and answers sign-in's 429", async () => {
    const address = "203.0.113.50";
    for (let i = 0; i < 10; i += 1) {
      fake.account(i % 2 ? ADA : null);
      const email = i % 2 ? "ada@example.com" : `nobody-${i}@example.com`;
      expect((await ask(email, address)).status).toBe(200);
    }
    const refused = await ask("someone-else@example.com", address);
    expect(refused.status).toBe(429);
    const wait = limiter.waitMs(forgotByAddress(address));
    expect(await refused.json()).toEqual({ error: tooManyMessage(wait) });
    expect(refused.headers.get("Retry-After")).toBeTruthy();
    // A refused request leaves nothing for later.
    await drain();
    fake.later.length = 0;
    limiter.clear(forgotByAddress(address));
  });

  it("counts one typed email across addresses, whatever its case, for an unknown email too", async () => {
    fake.account(null);
    for (let i = 0; i < 10; i += 1) {
      const email = i % 2 ? "Ghost@Example.com" : "ghost@example.com";
      expect((await ask(email)).status).toBe(200);
    }
    expect((await ask("GHOST@example.com")).status).toBe(429);
    // A different email from a fresh address is not held up by it.
    expect((await ask("other@example.com")).status).toBe(200);
    expect(limiter.waitMs(forgotByEmail("ghost@example.com"))).toBeLessThanOrEqual(WINDOW_MS);
    limiter.clear(forgotByEmail("ghost@example.com"));
  });
});
