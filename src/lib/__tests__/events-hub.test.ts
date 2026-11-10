import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ pool: { query: async () => undefined } }));

const { makeHub, RETRY_FIRST_MS, RETRY_MAX_MS } = await import("@/lib/events");
type Listener = Parameters<ReturnType<typeof makeHub>["subscribe"]>[1];

/** A LISTEN connection the test drops and refuses at will. */
class FakeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one map holds both kinds of handler.
  handlers = new Map<string, ((msg?: any) => void)[]>();
  ended = false;
  constructor(private refuse: boolean) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as the map above.
  on(event: string, fn: (msg?: any) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, msg?: unknown) {
    for (const fn of this.handlers.get(event) ?? []) fn(msg);
  }
  async connect() {
    if (this.refuse) throw new Error("connection refused");
  }
  async query() {}
  async end() {
    this.ended = true;
  }
  say(event: object) {
    this.emit("notification", { payload: JSON.stringify(event) });
  }
}

function setUp() {
  const clients: FakeClient[] = [];
  const state = { refuse: false };
  const hub = makeHub(() => {
    const client = new FakeClient(state.refuse);
    clients.push(client);
    return client;
  });
  return { hub, clients, state, last: () => clients[clients.length - 1] };
}

const heard = () => vi.fn<Listener>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the LISTEN hub", () => {
  it("connects once and hands each project only its own events", async () => {
    const { hub, clients } = setUp();
    const a = heard();
    const b = heard();
    await hub.subscribe("p1", a);
    await hub.subscribe("p2", b);
    expect(clients).toHaveLength(1);
    expect(hub.listening()).toBe(true);

    clients[0].say({ projectId: "p1", scope: "task", taskId: "t" });
    expect(a).toHaveBeenCalledWith({ projectId: "p1", scope: "task", taskId: "t" });
    expect(b).not.toHaveBeenCalled();
  });

  it("closes a dropped client, connects again, and rings every project once", async () => {
    const { hub, clients, last } = setUp();
    const a = heard();
    const b = heard();
    await hub.subscribe("p1", a);
    await hub.subscribe("p2", b);

    clients[0].emit("error");
    clients[0].emit("end");
    expect(clients[0].ended).toBe(true);
    expect(hub.listening()).toBe(false);

    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(clients).toHaveLength(2);
    expect(hub.listening()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ projectId: "p1", scope: "board" });
    expect(b).toHaveBeenCalledWith({ projectId: "p2", scope: "board" });

    last().say({ projectId: "p1", scope: "board" });
    expect(a).toHaveBeenCalledTimes(2);
  });

  it("waits longer after each failure, and rings once it is back", async () => {
    const { hub, clients, state } = setUp();
    const a = heard();
    await hub.subscribe("p1", a);
    state.refuse = true;
    clients[0].emit("end");

    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS * 2 - 1);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(3);
    expect(a).not.toHaveBeenCalled();

    state.refuse = false;
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(hub.listening()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("stops trying once nobody listens", async () => {
    const { hub, clients } = setUp();
    const off = await hub.subscribe("p1", heard());
    off();
    clients[0].emit("end");
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2);
    expect(clients).toHaveLength(1);
  });

  it("does not let a late end from an old client touch the new one", async () => {
    const { hub, clients } = setUp();
    const a = heard();
    await hub.subscribe("p1", a);
    clients[0].emit("error");
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(hub.listening()).toBe(true);

    clients[0].emit("end");
    clients[0].say({ projectId: "p1", scope: "task" });
    expect(hub.listening()).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(clients).toHaveLength(2);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("subscribes a stream whose first connect fails, and rings it when LISTEN comes", async () => {
    const { hub, clients, state } = setUp();
    state.refuse = true;
    const a = heard();
    await hub.subscribe("p1", a);
    expect(hub.listening()).toBe(false);

    state.refuse = false;
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(clients).toHaveLength(2);
    expect(a).toHaveBeenCalledWith({ projectId: "p1", scope: "board" });
  });
});
