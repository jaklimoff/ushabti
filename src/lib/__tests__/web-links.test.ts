import { describe, expect, it, vi } from "vitest";
import { isLink, linkKey, linkLabel, readLinks } from "../web-links";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));

const { coerceValue, describeValue } = await import("../values");

const LINK = { id: "p-pr", projectId: "pr-1", name: "Pull requests", type: "link" as const };
const PR = "https://github.com/acme/shop/pull/12";

describe("what the server keeps", () => {
  it("keeps http and https links and refuses anything else", async () => {
    expect(await coerceValue(LINK, [PR, "http://example.org/a"])).toEqual([
      PR,
      "http://example.org/a",
    ]);
    for (const bad of [
      "javascript:alert(1)",
      "ftp://example.org/file",
      "not a link",
      "mailto:a@b.c",
    ]) {
      await expect(coerceValue(LINK, [bad])).rejects.toMatchObject({
        status: 400,
        message: "Pull requests takes only http and https links.",
      });
    }
  });

  it("keeps at most 20 links", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `${PR}${i}`);
    expect(await coerceValue(LINK, twenty)).toHaveLength(20);
    await expect(coerceValue(LINK, [...twenty, "https://example.org/21"])).rejects.toMatchObject({
      status: 400,
      message: "Pull requests holds at most 20 links.",
    });
  });

  it("keeps a link of at most 2000 characters", async () => {
    const long = `https://example.org/${"a".repeat(2000 - 20)}`;
    expect(long).toHaveLength(2000);
    expect(await coerceValue(LINK, [long])).toEqual([long]);
    await expect(coerceValue(LINK, [`${long}a`])).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a value that is not a list of words", async () => {
    await expect(coerceValue(LINK, [12])).rejects.toMatchObject({ status: 400 });
    await expect(coerceValue(LINK, { url: PR })).rejects.toMatchObject({ status: 400 });
  });

  it("takes one link on its own as a list of one", async () => {
    expect(await coerceValue(LINK, PR)).toEqual([PR]);
  });
});

describe("an empty value, and a link given two times", () => {
  it("is [] when empty", async () => {
    expect(await coerceValue(LINK, null)).toEqual([]);
    expect(await coerceValue(LINK, "")).toEqual([]);
    expect(await coerceValue(LINK, [])).toEqual([]);
    expect(await coerceValue(LINK, ["  "])).toEqual([]);
  });

  it("does not store a link a second time with a trailing / or a #fragment", async () => {
    expect(await coerceValue(LINK, [PR, `${PR}/`, `${PR}#issuecomment-1`, `${PR}/#top`])).toEqual([
      PR,
    ]);
  });

  it("keeps the first form it was given", () => {
    expect(readLinks([`${PR}#discussion`, PR])).toEqual([`${PR}#discussion`]);
  });

  it("compares by the address without its fragment or its last /", () => {
    expect(linkKey(`${PR}/#x`)).toBe(PR);
    expect(linkKey(" https://example.org/ ")).toBe("https://example.org");
  });

  it("knows a link the server would keep", () => {
    expect(isLink(PR)).toBe(true);
    expect(isLink("javascript:alert(1)")).toBe(false);
    expect(isLink("")).toBe(false);
  });
});

describe("how a link reads", () => {
  it("reads a pull request, an issue or a merge request as owner/repo#N, whatever the host", () => {
    expect(linkLabel(PR)).toBe("acme/shop#12");
    expect(linkLabel("https://github.com/acme/shop/issues/7")).toBe("acme/shop#7");
    expect(linkLabel("https://gitea.example.org/acme/shop/pulls/3")).toBe("acme/shop#3");
    expect(linkLabel("https://gitlab.com/group/sub/shop/-/merge_requests/41")).toBe("sub/shop#41");
    expect(linkLabel(`${PR}/#issuecomment-1`)).toBe("acme/shop#12");
  });

  it("reads any other link as its host and path, made shorter", () => {
    expect(linkLabel("https://www.example.org/docs/page?x=1")).toBe("example.org/docs/page");
    expect(linkLabel("https://example.org/")).toBe("example.org");
    const long = linkLabel(`https://example.org/${"a".repeat(100)}`);
    expect(long.length).toBe(48);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the activity line", () => {
  it("says how many links, not the addresses", async () => {
    expect(await describeValue(LINK, [PR, "https://example.org"])).toBe("2 links");
    expect(await describeValue(LINK, [PR])).toBe("1 link");
    expect(await describeValue(LINK, [])).toBe("empty");
  });
});
