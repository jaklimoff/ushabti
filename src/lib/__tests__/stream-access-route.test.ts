import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

/* The hub is tested on its own in `events-hub.test.ts`. Here it only counts
   who is subscribed, and can hold a subscribe open to cancel during it. */
const hub = vi.hoisted(() => ({
  live: new Set<object>(),
  gate: null as Promise<void> | null,
}));
vi.mock("@/lib/events", () => ({
  isPresence: (event: { kind?: string }) => event.kind === "presence",
  publish: async () => undefined,
  subscribe: async () => {
    if (hub.gate) await hub.gate;
    const mine = {};
    hub.live.add(mine);
    return () => hub.live.delete(mine);
  },
}));
vi.mock("@/lib/ask-sender", () => ({ kickAskMail: () => undefined }));

const { and, eq } = await import("drizzle-orm");
const { db } = await import("@/db");
const { agentTokens, projectMembers, sessions } = await import("@/db/schema");
const { requests } = await import("@/test/headers");
const { agent, join, person, project } = await import("@/test/route");
const { LISTEN_TOUCH_MS } = await import("@/lib/presence");
const projectStream = await import("@/app/api/projects/[projectId]/stream/route");
const homeStream = await import("@/app/api/home/stream/route");

type Caller = { headers: Record<string, string> };

/** Opens a stream as `who`, with a signal the test can abort. */
async function open(who: Caller, projectId?: string) {
  const abort = new AbortController();
  const path = projectId ? `/api/projects/${projectId}/stream` : "/api/home/stream";
  const req = new Request(new URL(path, "http://localhost"), {
    headers: who.headers,
    signal: abort.signal,
  });
  const res = await requests.run(req, () =>
    projectId
      ? projectStream.GET(req, { params: Promise.resolve({ projectId }) })
      : homeStream.GET(req),
  );
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  return {
    abort,
    reader,
    /** Reads until `text` has come, or the stream ends. True when it came. */
    async until(text: string): Promise<boolean> {
      while (!seen.includes(text)) {
        const { done, value } = await reader.read();
        if (done) return false;
        seen += decoder.decode(value);
      }
      seen = seen.slice(seen.indexOf(text) + text.length);
      return true;
    },
    /** Reads to the end, and says whether it ended. */
    async ended(): Promise<boolean> {
      for (;;) {
        const { done } = await reader.read();
        if (done) return true;
      }
    },
  };
}

beforeEach(() => {
  hub.live.clear();
  hub.gate = null;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => vi.useRealTimers());

describe("an open stream after its access is gone", () => {
  it("closes a removed member's board stream within one ping, and keeps the owner's", async () => {
    const owner = await person("Owner");
    const member = await person("Member");
    const p = await project(owner);
    await join(p.id, member, "member");

    const theirs = await open(member, p.id);
    const mine = await open(owner, p.id);
    expect(await theirs.until("event: ready")).toBe(true);
    expect(await mine.until("event: ready")).toBe(true);

    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, member.id)));
    vi.advanceTimersByTime(LISTEN_TOUCH_MS);

    expect(await theirs.ended()).toBe(true);
    expect(await mine.until(": ping")).toBe(true);
    /* Only the owner's subscriptions are left. */
    expect(hub.live.size).toBeGreaterThan(0);
    mine.abort.abort();
    await vi.waitFor(() => expect(hub.live.size).toBe(0));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes an agent's stream once its token is revoked", async () => {
    const owner = await person("Owner");
    const p = await project(owner);
    const bot = await agent(owner, p.id);

    const stream = await open(bot.caller, p.id);
    expect(await stream.until("event: ready")).toBe(true);

    await db
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(agentTokens.id, bot.tokenId));
    vi.advanceTimersByTime(LISTEN_TOUCH_MS);

    expect(await stream.ended()).toBe(true);
    expect(hub.live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes Home's stream once the session has ended", async () => {
    const owner = await person("Owner");
    await project(owner);
    const stream = await open(owner);
    expect(await stream.until("event: ready")).toBe(true);
    expect(hub.live.size).toBe(1);

    await db.delete(sessions).where(eq(sessions.userId, owner.id));
    vi.advanceTimersByTime(LISTEN_TOUCH_MS);

    expect(await stream.ended()).toBe(true);
    expect(hub.live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a stream cancelled while it starts", () => {
  function held() {
    let let_go = () => {};
    hub.gate = new Promise<void>((resolve) => (let_go = resolve));
    return () => let_go();
  }

  it("leaves no subscription and no timer when cancelled during the subscribe", async () => {
    const owner = await person("Owner");
    const p = await project(owner);
    await project(owner);
    const go = held();
    const stream = await open(owner, p.id);
    await stream.reader.cancel();
    go();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves nothing behind when aborted during the subscribe", async () => {
    const owner = await person("Owner");
    const p = await project(owner);
    await project(owner);
    const go = held();
    const stream = await open(owner, p.id);
    stream.abort.abort();
    go();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves nothing behind when Home's stream is aborted while it follows", async () => {
    const owner = await person("Owner");
    await project(owner);
    await project(owner);
    const go = held();
    const stream = await open(owner);
    stream.abort.abort();
    go();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hub.live.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
