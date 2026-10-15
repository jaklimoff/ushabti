import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BURST_MS, homeReader } from "../home-live";

describe("when Home reads itself again", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function reader() {
    const read = vi.fn();
    const state = { hidden: false };
    const live = homeReader({ read, hidden: () => state.hidden });
    return { read, state, live };
  }

  it("answers a burst of rings with one read", () => {
    const { read, live } = reader();
    for (let i = 0; i < 20; i++) live.ring();
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again for a ring after the burst was answered", () => {
    const { read, live } = reader();
    live.ring();
    vi.advanceTimersByTime(BURST_MS);
    live.ring();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads nothing while hidden, and once when shown", () => {
    const { read, state, live } = reader();
    state.hidden = true;
    for (let i = 0; i < 5; i++) live.ring();
    vi.advanceTimersByTime(BURST_MS * 10);
    expect(read).not.toHaveBeenCalled();

    state.hidden = false;
    live.shown();
    live.shown();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("holds a burst that was waiting when the tab was hidden", () => {
    const { read, state, live } = reader();
    live.ring();
    state.hidden = true;
    vi.advanceTimersByTime(BURST_MS);
    expect(read).not.toHaveBeenCalled();
    state.hidden = false;
    live.shown();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when shown if nothing rang", () => {
    const { read, live } = reader();
    live.shown();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads nothing after it stopped", () => {
    const { read, live } = reader();
    live.ring();
    live.stop();
    vi.advanceTimersByTime(BURST_MS);
    expect(read).not.toHaveBeenCalled();
  });
});
