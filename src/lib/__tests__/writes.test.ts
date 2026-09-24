import { describe, expect, it, vi } from "vitest";
import { trackWrites } from "../writes";

describe("whether a read may land", () => {
  it("keeps a read that no write crossed", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const done = writes.begin();
    done();
    const read = writes.reading();
    expect(writes.keep(read)).toBe(true);
    expect(again).not.toHaveBeenCalled();
  });

  it("drops a read when a write goes out while it is out", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const read = writes.reading();
    const done = writes.begin();
    expect(writes.keep(read)).toBe(false);
    expect(again).not.toHaveBeenCalled();
    done();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("drops a read that went out while a write was out, even if it comes back first", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const done = writes.begin();
    const read = writes.reading();
    expect(writes.keep(read)).toBe(false);
    expect(again).not.toHaveBeenCalled();
    done();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("drops a read that went out while a write was out and comes back after it", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const done = writes.begin();
    const read = writes.reading();
    done();
    expect(again).not.toHaveBeenCalled();
    expect(writes.keep(read)).toBe(false);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("drops a read that a write came and went during, and asks again at once", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const read = writes.reading();
    writes.begin()();
    expect(writes.keep(read)).toBe(false);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("asks again only once the last write is answered", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const first = writes.begin();
    const second = writes.begin();
    expect(writes.keep(writes.reading())).toBe(false);
    first();
    expect(again).not.toHaveBeenCalled();
    second();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("counts a write answered twice once", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const first = writes.begin();
    const second = writes.begin();
    first();
    first();
    expect(writes.keep(writes.reading())).toBe(false);
    expect(again).not.toHaveBeenCalled();
    second();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("drops an older read that comes back after a newer one went out, and owes nothing", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    const older = writes.reading();
    const newer = writes.reading();
    expect(writes.keep(older)).toBe(false);
    expect(writes.keep(newer)).toBe(true);
    expect(again).not.toHaveBeenCalled();
  });

  it("asks nothing again when no read was dropped", () => {
    const again = vi.fn();
    const writes = trackWrites(again);
    writes.begin()();
    writes.begin()();
    expect(again).not.toHaveBeenCalled();
  });
});
