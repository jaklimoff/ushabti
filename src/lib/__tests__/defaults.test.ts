import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWS, defaultViewConfig } from "../defaults";

describe("the views a new project starts with", () => {
  const ids = new Map([
    ["Status:Later", "o-later"],
    ["Status:Todo", "o-todo"],
  ]);

  it("starts the main board with its parking column folded", () => {
    const board = DEFAULT_VIEWS.find((v) => v.isDefault)!;
    expect(board.kind).toBe("board");
    expect(defaultViewConfig(board, ids)).toEqual({ startFolded: ["o-later"] });
  });

  it("folds nothing on a list", () => {
    const list = DEFAULT_VIEWS.find((v) => v.kind === "list")!;
    expect(defaultViewConfig(list, ids)).toEqual({});
  });
});
