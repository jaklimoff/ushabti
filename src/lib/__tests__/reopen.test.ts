import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoff, keepOpen } from "../reopen";

type Fake = {
  url: string;
  readyState: number;
  closed: boolean;
  listeners: Record<string, (() => void)[]>;
  addEventListener: (kind: string, listener: () => void) => void;
  close: () => void;
  fire: (kind: string) => void;
};

function fake(url: string): Fake {
  const source: Fake = {
    url,
    readyState: 1,
    closed: false,
    listeners: {},
    addEventListener(kind, listener) {
      (source.listeners[kind] ??= []).push(listener);
    },
    close() {
      source.closed = true;
      source.readyState = 2;
    },
    fire(kind) {
      for (const listener of source.listeners[kind] ?? []) listener();
    },
  };
  return source;
}

describe("backoff", () => {
  it("grows, is capped, and lands between half and the whole step", () => {
    expect(backoff(0, () => 0)).toBe(1_000);
    expect(backoff(0, () => 1)).toBe(2_000);
    expect(backoff(1, () => 1)).toBe(4_000);
    expect(backoff(3, () => 1)).toBe(16_000);
    expect(backoff(10, () => 1)).toBe(30_000);
    expect(backoff(10, () => 0)).toBe(15_000);
  });
});

describe("keepOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens a new source after one is closed for good, and lends it before letting the old go", () => {
    const opened: Fake[] = [];
    const said: string[] = [];
    const stop = keepOpen(
      () => {
        const source = fake(`s${opened.length}`);
        opened.push(source);
        return source as unknown as EventSource;
      },
      (source) => {
        said.push(`attach ${source.url}`);
        return () => said.push(`detach ${source.url}`);
      },
    );
    expect(opened).toHaveLength(1);

    /* A source trying again by itself is left to it. */
    opened[0].readyState = 0;
    opened[0].fire("error");
    vi.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(1);

    opened[0].readyState = 2;
    opened[0].fire("error");
    opened[0].fire("error");
    vi.advanceTimersByTime(999);
    expect(opened).toHaveLength(1);
    vi.advanceTimersByTime(1_001);
    expect(opened).toHaveLength(2);
    expect(said).toEqual(["attach s0", "attach s1", "detach s0"]);

    stop();
    expect(said.at(-1)).toBe("detach s1");
    expect(opened[1].closed).toBe(true);
  });

  it("waits longer each time, and starts over once a source says ready", () => {
    const opened: Fake[] = [];
    vi.spyOn(Math, "random").mockReturnValue(1);
    const stop = keepOpen(
      () => {
        const source = fake(`s${opened.length}`);
        opened.push(source);
        return source as unknown as EventSource;
      },
      () => () => {},
    );
    const fail = () => {
      const last = opened.at(-1)!;
      last.readyState = 2;
      last.fire("error");
    };
    fail();
    vi.advanceTimersByTime(2_000);
    expect(opened).toHaveLength(2);
    fail();
    vi.advanceTimersByTime(2_000);
    expect(opened).toHaveLength(2);
    vi.advanceTimersByTime(2_000);
    expect(opened).toHaveLength(3);

    opened[2].fire("ready");
    fail();
    vi.advanceTimersByTime(2_000);
    expect(opened).toHaveLength(4);

    stop();
    fail();
    vi.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(4);
    vi.restoreAllMocks();
  });
});
