import { describe, expect, it } from "vitest";
import type { ProjectNow } from "../queries";
import { foldCookie, lineOf, projectOfPath, readFolded, sidebarShown } from "../sidebar";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const project = (more: Partial<ProjectNow> = {}): ProjectNow => ({
  id: "p",
  key: "USH",
  name: "Ushabti",
  color: "#000",
  waiting: 0,
  agents: [],
  lastAt: null,
  ...more,
});
const agent = (name: string, minutes: number, working = true) => ({
  id: name,
  name,
  taskKey: `USH-${minutes}`,
  reportedAt: ago(minutes),
  working,
});

describe("the fold", () => {
  it("starts folded, and only open reads as open", () => {
    expect(readFolded(undefined)).toBe(true);
    expect(readFolded("folded")).toBe(true);
    expect(readFolded("nonsense")).toBe(true);
    expect(readFolded("open")).toBe(false);
  });

  it("is a cookie the whole site sends for a year", () => {
    expect(foldCookie(false)).toMatch(/^ushabti-sidebar=open; path=\/; max-age=31536000/);
    expect(foldCookie(true)).toMatch(/^ushabti-sidebar=folded;/);
  });
});

describe("when the sidebar is drawn", () => {
  it("needs a second project or a first list", () => {
    expect(sidebarShown([1], [])).toBe(false);
    expect(sidebarShown([1, 2], [])).toBe(true);
    expect(sidebarShown([1], [1])).toBe(true);
  });

  it("knows the open project from the address", () => {
    expect(projectOfPath("/p/abc")).toBe("abc");
    expect(projectOfPath("/p/abc/settings/people")).toBe("abc");
    expect(projectOfPath("/projects")).toBeNull();
    expect(projectOfPath("/lists/x")).toBeNull();
  });
});

describe("the line under a project", () => {
  it("reads Quiet when nothing happens", () => {
    expect(lineOf(project(), NOW)).toEqual({ kind: "quiet", text: "Quiet" });
  });

  it("names the newest agent at work, its task and its age, and counts the rest", () => {
    expect(lineOf(project({ agents: [agent("Builder", 2)] }), NOW).text).toBe(
      "Builder on USH-2 · 2m",
    );
    expect(lineOf(project({ agents: [agent("Builder", 9), agent("Scout", 3)] }), NOW).text).toBe(
      "Scout on USH-3 · 3m +1",
    );
  });

  it("reads a silent agent as Home does", () => {
    expect(lineOf(project({ agents: [agent("Scout", 90, false)] }), NOW)).toEqual({
      kind: "silent",
      text: "Scout silent",
    });
  });

  it("puts what waits for the person before who works", () => {
    expect(lineOf(project({ waiting: 2, agents: [agent("Builder", 2)] }), NOW)).toEqual({
      kind: "waiting",
      text: "2 waiting for you",
    });
  });
});
