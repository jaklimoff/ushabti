import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readGitHubFile } from "../github";
import { alreadyOf, planImport, previewOf, type ProjectShape } from "../plan";
import { readExport } from "../read";
import { MAX_CARDS, MAX_FILE_BYTES, TOO_LARGE, type SourceBoard } from "../source";

/**
 * Reading the JSON of `gh project item-list`.
 *
 * The fixture holds an issue, a pull request, a draft, an item the token could
 * not read, an issue with no status, and fewer items than `totalCount`. Its
 * keys are the ones gh writes: each field under its name with the first
 * letter lowercased.
 */

const GITHUB_FIXTURE = "src/test/fixtures/github-small.json";

function raw(): string {
  return readFileSync(GITHUB_FIXTURE, "utf8");
}

function read(file: string = raw()): SourceBoard {
  const got = readExport(file);
  if (!got.ok) throw new Error(got.said);
  return got.board;
}

const STATUS = "prop-status";

function shape(over: Partial<ProjectShape> = {}): ProjectShape {
  return {
    properties: [
      {
        id: STATUS,
        name: "Status",
        type: "select",
        options: [
          { id: "opt-todo", name: "Todo" },
          { id: "opt-doing", name: "in progress" },
        ],
      },
      { id: "prop-labels", name: "Labels", type: "multi_select", options: [] },
    ],
    members: [{ id: "user-ada", name: "Ada" }],
    groupPropertyId: STATUS,
    already: new Set<string>(),
    ...over,
  };
}

describe("reading a gh item-list file", () => {
  it("is picked by its items and its total, and names the board", () => {
    const board = read();
    expect(board.source.word).toBe("github");
    expect(board.source.name).toBe("GitHub");
    expect(board.name).toBe("A GitHub project");
  });

  it("brings issues, pull requests and drafts in the file's order, with title and body", () => {
    expect(read().cards.map((c) => [c.name, c.desc])).toEqual([
      ["Fix the sign-in loop", "Signing in with a link sends you back to the sign-in page."],
      ["Speed up the board", "Draws each card once."],
      ["Write the launch note", "Ask Ada for the numbers."],
      ["Plan the next release", ""],
    ]);
  });

  it("keys an issue by its address and a draft by its item id", () => {
    expect(read().cards.map((c) => [c.id, c.shortLink, c.link])).toEqual([
      [
        "https://github.com/acme/web/issues/12",
        "acme/web#12",
        "https://github.com/acme/web/issues/12",
      ],
      ["https://github.com/acme/web/pull/15", "acme/web#15", "https://github.com/acme/web/pull/15"],
      ["PVTI_lADOBq2dAc4AeX1Azg0aAAM", "PVTI_lADOBq2dAc4AeX1Azg0aAAM", null],
      [
        "https://github.com/acme/api/issues/3",
        "acme/api#3",
        "https://github.com/acme/api/issues/3",
      ],
    ]);
  });

  it("makes a list of each status in the order first seen, and none for an item with none", () => {
    const board = read();
    expect(board.lists.map((l) => l.name)).toEqual(["In Progress", "Done", "Todo"]);
    expect(board.cards.find((c) => c.name === "Plan the next release")?.listId).toBeNull();
  });

  it("reads labels as names and assignees as logins", () => {
    const board = read();
    expect(board.labels.map((l) => l.name)).toEqual(["bug", "perf", "Release"]);
    expect(board.members.map((m) => m.name)).toEqual(["ada", "grace", "octocat"]);
    const pr = board.cards.find((c) => c.name === "Speed up the board")!;
    expect(pr.labelIds.map((id) => board.labels.find((l) => l.id === id)?.name)).toEqual([
      "perf",
      "bug",
    ]);
  });

  it("says first when the file is shorter than the project", () => {
    expect(read().warning).toBe(
      "This file holds 5 of the project's 8 items. Export it again with --limit 2000 to bring them all.",
    );
    const whole = JSON.parse(raw()) as { totalCount: number };
    whole.totalCount = 5;
    expect(read(JSON.stringify(whole)).warning).toBeNull();
  });

  it("keeps the limits and their sentences", () => {
    const many = { items: Array.from({ length: MAX_CARDS + 1 }, () => ({})), totalCount: 1 };
    expect(readGitHubFile(many)).toEqual({
      ok: false,
      said: `That export has ${MAX_CARDS + 1} cards. An import takes ${MAX_CARDS} at a time.`,
    });
    const big = JSON.stringify({ items: [], totalCount: 0, pad: "x".repeat(MAX_FILE_BYTES) });
    expect(readExport(big)).toEqual({ ok: false, said: TOO_LARGE });
  });
});

describe("planning a GitHub project", () => {
  it("matches a status to an option in any case and adds the rest", () => {
    const plan = planImport(read(), shape());
    expect(plan.lists.map((l) => [l.name, l.optionId])).toEqual([
      ["In Progress", "opt-doing"],
      ["Done", null],
      ["Todo", "opt-todo"],
    ]);
    expect(previewOf(plan).columnless).toBe(1);
  });

  it("assigns a login a member carries, and names the others on the last line", () => {
    const plan = planImport(read(), shape());
    const [issue, pr] = plan.tasks;
    expect(issue.assigneeId).toBe("user-ada");
    expect(pr.assigneeId).toBeNull();
    expect(pr.description).toBe("Draws each card once.\n\nAssigned on GitHub to octocat.");
    /* Ada and Grace on one issue: Grace is the second person, and counted. */
    expect(plan.extraMembers).toBe(1);
  });

  it("puts the address in Link, made when the board has none, and none on a draft", () => {
    const plan = planImport(read(), shape());
    expect(plan.linkProperty).toEqual({ id: null, name: "Link", making: true });
    expect(plan.tasks.map((t) => t.link)).toEqual([
      "https://github.com/acme/web/issues/12",
      "https://github.com/acme/web/pull/15",
      null,
      "https://github.com/acme/api/issues/3",
    ]);
    const found = planImport(
      read(),
      shape({
        properties: [
          ...shape().properties,
          { id: "prop-link", name: "link", type: "link", options: [] },
        ],
      }),
    );
    expect(found.linkProperty).toEqual({ id: "prop-link", name: "link", making: false });
    expect(previewOf(plan).properties).toContainEqual({ name: "Link", making: true });
  });

  it("makes nothing twice, and an issue from another project of the same repo comes once", () => {
    const first = planImport(read(), shape());
    const lines = first.tasks.map((t) => ({ data: { source: "github", sourceId: t.sourceId } }));
    const again = planImport(read(), shape({ already: alreadyOf(lines, "github") }));
    expect(again.tasks).toHaveLength(0);
    expect(again.already).toBe(4);

    /* Another project holding issue #12 as an item of its own id. */
    const other = JSON.parse(raw()) as { items: { id: string }[] };
    other.items[0].id = "PVTI_another_project";
    const shared = planImport(
      read(JSON.stringify(other)),
      shape({ already: alreadyOf(lines, "github") }),
    );
    expect(shared.tasks).toHaveLength(0);
  });

  it("names what it leaves behind, the cut file first", () => {
    const preview = previewOf(planImport(read(), shape()));
    expect(preview.warning).toBe(
      "This file holds 5 of the project's 8 items. Export it again with --limit 2000 to bring them all.",
    );
    expect(preview.dropped).toEqual([
      "Milestone, Priority and Iteration are not brought in.",
      "1 item links a pull request; that link is left behind.",
      "1 item names reviewers; they are left behind.",
      "1 item this token could not read is left behind.",
      "1 card names a second person; only the first one comes.",
      "The file never carries comments, open or closed state, sub-issue links, archived items, empty columns or the column order.",
    ]);
  });
});
