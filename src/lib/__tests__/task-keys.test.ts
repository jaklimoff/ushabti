import { describe, expect, it } from "vitest";
import { renderMarkdown, taskKeysIn, type TaskLinks } from "../task-keys";

const links: TaskLinks = { projectId: "p1", projectKey: "USH", keys: ["USH-12", "USH-3"] };
const anchor = (written: string, key = written.toUpperCase()) =>
  `<a href="/p/p1?task=${key}" data-task-key="${key}">${written}</a>`;

describe("taskKeysIn", () => {
  it("finds a key of this project in any letter case", () => {
    expect(taskKeysIn("waits on USH-12 and ush-3.", "USH")).toEqual([
      { index: 9, written: "USH-12", key: "USH-12" },
      { index: 20, written: "ush-3", key: "USH-3" },
    ]);
  });

  it("finds a key only as a word of its own", () => {
    expect(taskKeysIn("xUSH-12", "USH")).toEqual([]);
    expect(taskKeysIn("USH-12x", "USH")).toEqual([]);
    expect(taskKeysIn("OLD-USH-12", "USH")).toEqual([]);
    expect(taskKeysIn("USH-12-fix", "USH")).toEqual([]);
    expect(taskKeysIn("USH-123", "USH").map((m) => m.key)).toEqual(["USH-123"]);
    expect(taskKeysIn("(USH-12)", "USH").map((m) => m.key)).toEqual(["USH-12"]);
  });

  it("never finds a key of another project", () => {
    expect(taskKeysIn("see OPS-12 and USHX-12", "USH")).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it("draws a known key as a link to the task, in the case it was written", () => {
    expect(renderMarkdown("waits on USH-12 and ush-3", links)).toBe(
      `<p>waits on ${anchor("USH-12")} and ${anchor("ush-3", "USH-3")}</p>\n`,
    );
  });

  it("does not match USH-12 inside USH-123", () => {
    expect(renderMarkdown("USH-123", links)).toBe("<p>USH-123</p>\n");
  });

  it("leaves an unknown key and a key of another project as plain text", () => {
    expect(renderMarkdown("USH-99 and OPS-12", links)).toBe("<p>USH-99 and OPS-12</p>\n");
  });

  it("leaves a key in inline code, a code block or a link as it was written", () => {
    const text = [
      "`USH-12`",
      "",
      "```",
      "USH-12",
      "```",
      "",
      "[see USH-12](https://x.test) https://x.test/USH-12 <a href='y'>USH-12</a> <code>USH-3</code>",
    ].join("\n");
    expect(renderMarkdown(text, links)).toBe(renderMarkdown(text));
    expect(renderMarkdown(text, links)).not.toContain("data-task-key");
  });

  it("finds a key in a list, a table, a quote and in bold", () => {
    const text = "- USH-12\n\n> USH-3\n\n**USH-12**\n\n| a |\n|---|\n| USH-3 |";
    const html = renderMarkdown(text, links);
    expect(html.match(/data-task-key/g)).toHaveLength(4);
  });

  it("links again after a raw link has closed", () => {
    expect(renderMarkdown("<a href='y'>x</a> USH-12", links)).toContain(anchor("USH-12"));
  });

  it("lets a raw tag left open quiet only its own paragraph", () => {
    const html = renderMarkdown("<code>USH-3\n\nThen USH-12", links);
    expect(html).not.toContain(anchor("USH-3"));
    expect(html).toContain(anchor("USH-12"));
  });

  it("escapes the words around a key as markdown always does", () => {
    expect(renderMarkdown("a < b & USH-12", links)).toBe(
      `<p>a &lt; b &amp; ${anchor("USH-12")}</p>\n`,
    );
  });

  it("draws plain markdown without links", () => {
    expect(renderMarkdown("USH-12")).toBe("<p>USH-12</p>\n");
  });
});
