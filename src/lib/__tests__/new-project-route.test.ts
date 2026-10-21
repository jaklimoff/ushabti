import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { board, person, project } = await import("@/test/route");

/*
 * What a project holds the moment it is made, read back the way a board
 * reads it. Every one of these is an ordinary property or view afterwards.
 */

type Option = { id: string; name: string; color: string };
type Property = { id: string; name: string; options: Option[] };
type View = { name: string; kind: string; groupById: string | null; isDefault: boolean };

describe("A new project", () => {
  it("opens Status on Later, a darker grey than Backlog, and ends it on Done", async () => {
    const owner = await person("Maker");
    const p = await project(owner);
    const read = await board(owner, p.id);
    const status = (read.properties as Property[]).find((x) => x.name === "Status")!;

    expect(status.options.map((o) => o.name)).toEqual([
      "Later",
      "Backlog",
      "Todo",
      "In Progress",
      "Ready",
      "Done",
    ]);
    expect(status.options[0].color).toBe("#4b5563");
    expect(read.project.doneWhen).toEqual({
      propertyId: status.id,
      optionIds: [status.options.find((o) => o.name === "Done")!.id],
    });
  });

  it("has no Phase, and opens with a Board and a List", async () => {
    const owner = await person("Maker");
    const p = await project(owner);
    const read = await board(owner, p.id);
    const properties = read.properties as Property[];
    const status = properties.find((x) => x.name === "Status")!;

    expect(properties.map((x) => x.name)).toEqual([
      "Status",
      "Priority",
      "Assignee",
      "Estimate",
      "Labels",
      "Due",
    ]);
    expect(
      (read.views as View[]).map(({ name, kind, groupById, isDefault }) => ({
        name,
        kind,
        groupById,
        isDefault,
      })),
    ).toEqual([
      { name: "Board", kind: "board", groupById: status.id, isDefault: true },
      { name: "List", kind: "list", groupById: null, isDefault: false },
    ]);
  });
});
