import { describe, expect, it } from "vitest";
import { type DragColumn, dragColumns, REST, scaleToFill } from "../column-fit";

const sum = (widths: Map<string, number>) => [...widths.values()].reduce((a, b) => a + b, 0);

describe("scaleToFill", () => {
  it("keeps the proportions and fills the total exactly", () => {
    const widths = scaleToFill(
      [
        { id: "a", base: 100, min: 10 },
        { id: "b", base: 200, min: 10 },
        { id: "c", base: 100, min: 10 },
      ],
      801,
    );
    expect(sum(widths)).toBe(801);
    expect(widths.get("b")).toBe(401);
    expect(widths.get("a")).toBe(200);
  });

  it("holds an item at its minimum and scales the rest without it", () => {
    const widths = scaleToFill(
      [
        { id: "a", base: 100, min: 90 },
        { id: "b", base: 300, min: 10 },
      ],
      200,
    );
    expect(Object.fromEntries(widths)).toEqual({ a: 90, b: 110 });
  });

  it("puts every item at its minimum when the minimums do not fit", () => {
    const widths = scaleToFill(
      [
        { id: "a", base: 100, min: 90 },
        { id: "b", base: 300, min: 120 },
      ],
      150,
    );
    expect(Object.fromEntries(widths)).toEqual({ a: 90, b: 120 });
  });
});

describe("dragColumns", () => {
  /* A row of 1000 px with no room left at the end, after the dragged column
     has been set to where the pointer is. */
  const row = (over: Record<string, number>, rest = 0): DragColumn[] =>
    [
      { id: "title", width: 300, min: 160, resizable: true },
      { id: "status", width: 300, min: 72, resizable: true },
      { id: "labels", width: 150, min: 72, resizable: true },
      { id: "estimate", width: 128, min: 104, resizable: true },
      { id: "due", width: 122 - rest, min: 88, resizable: true },
      { id: REST, width: rest, min: 0, resizable: true },
    ].map((column) => ({ ...column, width: over[column.id] ?? column.width }));

  it("takes a widened column's room from the columns to its right, in proportion", () => {
    const widths = dragColumns(row({ title: 360 }), "title", 1000);
    expect(widths.has("title")).toBe(false);
    expect(sum(widths)).toBe(300 + 150 + 128 + 122 - 60);
    expect(widths.get("status")).toBeLessThan(300);
    expect(widths.get("labels")).toBeLessThan(150);
  });

  it("takes from the room at the end first, and leaves the columns alone while it lasts", () => {
    const widths = dragColumns(row({ title: 340 }, 50), "title", 1000);
    // 40 of the 50 empty pixels; nobody else moves.
    expect(Object.fromEntries(widths)).toEqual({ [REST]: 10 });
  });

  it("goes on to the columns once the room at the end is used up", () => {
    const widths = dragColumns(row({ title: 360 }, 50), "title", 1000);
    expect(widths.get(REST)).toBe(0);
    expect(sum(widths) - (widths.get(REST) ?? 0)).toBe(300 + 150 + 128 + 72 - 10);
  });

  it("gives a narrowed column's room to the end, and moves no other column", () => {
    const widths = dragColumns(row({ status: 250 }), "status", 1000);
    expect(Object.fromEntries(widths)).toEqual({ [REST]: 50 });
  });

  it("leaves the columns to the left alone", () => {
    const widths = dragColumns(row({ labels: 200 }), "labels", 1000);
    expect(widths.has("title")).toBe(false);
    expect(widths.has("status")).toBe(false);
    // Estimate reaches its floor first, so Due gives the rest of the 50.
    expect(widths.get("estimate")).toBe(104);
    expect(widths.get("due")).toBe(96);
    expect(widths.has("labels")).toBe(false);
  });

  it("stops the drag when every column to the right is at its minimum", () => {
    const widths = dragColumns(row({ labels: 300 }), "labels", 1000);
    expect(widths.get("estimate")).toBe(104);
    expect(widths.get("due")).toBe(88);
    expect(widths.get("labels")).toBe(150 + 24 + 34);
  });

  it("takes from the left when nothing is to the right: the last column", () => {
    const widths = dragColumns(row({ due: 172 }), "due", 1000);
    expect(widths.has("due")).toBe(false);
    expect(sum(widths)).toBe(300 + 300 + 150 + 128 - 50);
  });

  it("changes nothing when the row already holds its width", () => {
    expect(dragColumns(row({}), "title", 1000).size).toBe(0);
  });
});
