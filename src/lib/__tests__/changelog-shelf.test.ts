import { describe, expect, it, vi } from "vitest";
import { createShelf, KEEP_MS, KEEP_PAGES } from "../changelog-shelf";

describe("the public changelog's shelf", () => {
  it("builds a page once and hands it to every visit after", async () => {
    const shelf = createShelf<string>();
    const build = vi.fn(async () => "page");
    expect(await shelf.get("p", 10, build, 0)).toBe("page");
    expect(await shelf.get("p", 10, build, 1000)).toBe("page");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("keeps each length of a project apart", async () => {
    const shelf = createShelf<number>();
    expect(await shelf.get("p", 10, async () => 10, 0)).toBe(10);
    expect(await shelf.get("p", 20, async () => 20, 0)).toBe(20);
    expect(await shelf.get("q", 10, async () => 99, 0)).toBe(99);
  });

  it("builds once for visits that arrive together", async () => {
    const shelf = createShelf<string>();
    let done!: (v: string) => void;
    const build = vi.fn(() => new Promise<string>((r) => (done = r)));
    const first = shelf.get("p", 10, build, 0);
    const second = shelf.get("p", 10, build, 0);
    done("page");
    expect(await Promise.all([first, second])).toEqual(["page", "page"]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("forgets every length of one project on a write, and no other project", async () => {
    const shelf = createShelf<string>();
    await shelf.get("p", 10, async () => "old", 0);
    await shelf.get("p", 20, async () => "old", 0);
    await shelf.get("q", 10, async () => "kept", 0);
    shelf.forget("p");
    expect(await shelf.get("p", 10, async () => "new", 0)).toBe("new");
    expect(await shelf.get("p", 20, async () => "new", 0)).toBe("new");
    expect(await shelf.get("q", 10, async () => "rebuilt", 0)).toBe("kept");
  });

  /* The read a build made may be older than the write, so a build still on
     its way is forgotten as well, and the next visit does not get it. */
  it("forgets a build still on its way", async () => {
    const shelf = createShelf<string>();
    let done!: (v: string) => void;
    const slow = shelf.get("p", 10, () => new Promise<string>((r) => (done = r)), 0);
    shelf.forget("p");
    done("before the write");
    expect(await slow).toBe("before the write");
    expect(await shelf.get("p", 10, async () => "after the write", 0)).toBe("after the write");
  });

  it("drops a page after the time it is kept", async () => {
    const shelf = createShelf<string>();
    await shelf.get("p", 10, async () => "old", 0);
    expect(await shelf.get("p", 10, async () => "new", KEEP_MS - 1)).toBe("old");
    expect(await shelf.get("p", 10, async () => "new", KEEP_MS)).toBe("new");
  });

  it("keeps no failed build, so the next visit tries again", async () => {
    const shelf = createShelf<string>();
    await expect(
      shelf.get("p", 10, async () => Promise.reject(new Error("down")), 0),
    ).rejects.toThrow("down");
    expect(await shelf.get("p", 10, async () => "up", 0)).toBe("up");
  });

  it("keeps at most so many pages, dropping the oldest", async () => {
    const shelf = createShelf<string>();
    for (let i = 0; i <= KEEP_PAGES; i += 1) await shelf.get(`p${i}`, 10, async () => "page", 0);
    expect(shelf.size()).toBe(KEEP_PAGES);
    expect(await shelf.get("p0", 10, async () => "again", 0)).toBe("again");
  });
});
