import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardReader,
  concerns,
  READY_JITTER_MS,
  RING_BURST_MS,
  RING_MAX_WAIT_MS,
  type Rung,
} from "../board-live";

describe("when an open board reads itself again", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function reader(random = () => 0.5) {
    const read = vi.fn();
    const rung = vi.fn<(taskIds: Rung) => void>();
    const state = { hidden: false };
    const live = boardReader({
      read,
      rung,
      hidden: () => state.hidden,
      now: () => Date.now(),
      random,
    });
    return { read, rung, state, live };
  }

  it("answers a burst of rings with one read", () => {
    const { read, live } = reader();
    for (let i = 0; i < 20; i++) live.ring();
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RING_BURST_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("still reads within the most it waits while the rings never stop", () => {
    const { read, live } = reader();
    /* A ring every 100 ms, closer than the burst, for six seconds. */
    for (let t = 0; t < 6_000; t += 100) {
      live.ring("a");
      vi.advanceTimersByTime(100);
    }
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(6_000 / RING_MAX_WAIT_MS));
    /* None waited much past the most. */
    read.mockClear();
    live.ring("a");
    for (let t = 0; t < RING_MAX_WAIT_MS; t += 100) {
      vi.advanceTimersByTime(100);
      live.ring("a");
    }
    expect(read).toHaveBeenCalled();
  });

  it("reads nothing while hidden, and once when shown", () => {
    const { read, rung, state, live } = reader();
    state.hidden = true;
    for (let i = 0; i < 5; i++) live.ring("a");
    live.ring("b");
    vi.advanceTimersByTime(RING_MAX_WAIT_MS * 10);
    expect(read).not.toHaveBeenCalled();

    state.hidden = false;
    live.shown();
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(rung).toHaveBeenCalledWith(["a", "b"]);

    live.shown();
    vi.advanceTimersByTime(RING_MAX_WAIT_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when shown if nothing rang", () => {
    const { read, state, live } = reader();
    state.hidden = true;
    state.hidden = false;
    live.shown();
    vi.advanceTimersByTime(RING_MAX_WAIT_MS);
    expect(read).not.toHaveBeenCalled();
  });

  it("owes a ring that was waiting when the tab was hidden", () => {
    const { read, state, live } = reader();
    live.ring();
    state.hidden = true;
    vi.advanceTimersByTime(RING_BURST_MS);
    expect(read).not.toHaveBeenCalled();
    state.hidden = false;
    live.shown();
    vi.advanceTimersByTime(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("names the tasks its rings named, or none when one ring named none", () => {
    const { rung, live } = reader();
    live.ring("a");
    live.ring("b");
    live.ring("a");
    vi.advanceTimersByTime(RING_BURST_MS);
    expect(rung).toHaveBeenLastCalledWith(["a", "b"]);

    live.ring("a");
    live.ring();
    vi.advanceTimersByTime(RING_BURST_MS);
    expect(rung).toHaveBeenLastCalledWith(null);
  });

  it("reads after `ready` only once its random wait is over", () => {
    const { read, rung, live } = reader(() => 0.5);
    live.ready();
    vi.advanceTimersByTime(READY_JITTER_MS * 0.5 - 1);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(rung).toHaveBeenCalledWith(null);
  });

  it("spreads the `ready` reads of many tabs", () => {
    const waits = [0, 0.3, 0.9].map((r) => {
      const { read, live } = reader(() => r);
      live.ready();
      return read;
    });
    vi.advanceTimersByTime(1);
    expect(waits.map((read) => read.mock.calls.length)).toEqual([1, 0, 0]);
    vi.advanceTimersByTime(READY_JITTER_MS);
    expect(waits.map((read) => read.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("reads nothing after it is stopped", () => {
    const { read, live } = reader();
    live.ring();
    live.ready();
    live.stop();
    vi.advanceTimersByTime(RING_MAX_WAIT_MS);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("which panel a ring concerns", () => {
  it("is every panel when the ring named no task", () => {
    expect(concerns(null, ["a"])).toBe(true);
    expect(concerns(undefined, ["a"])).toBe(true);
  });

  it("is the panel of the task it named, or of one that task is linked to", () => {
    expect(concerns(["a"], ["a"])).toBe(true);
    expect(concerns(["b"], ["a", "b"])).toBe(true);
  });

  it("is no panel of another task", () => {
    expect(concerns(["b"], ["a"])).toBe(false);
    expect(concerns([], ["a"])).toBe(false);
  });
});
