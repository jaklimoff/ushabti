import { describe, expect, it } from "vitest";
import {
  chartDays,
  chartFrom,
  chartHeading,
  chartHint,
  chartSplit,
  chartSummary,
  dayBefore,
  sameSources,
  sourceShape,
  sumChart,
} from "@/lib/charts";

describe("dayBefore", () => {
  it("crosses a month, a year and a leap day", () => {
    expect(dayBefore("2026-03-01", 1)).toBe("2026-02-28");
    expect(dayBefore("2024-03-01", 1)).toBe("2024-02-29");
    expect(dayBefore("2026-01-05", 10)).toBe("2025-12-26");
    expect(dayBefore("2026-10-09", 0)).toBe("2026-10-09");
  });

  it("is a calendar day, so a clock change in a zone moves nothing", () => {
    expect(dayBefore("2026-03-30", 1)).toBe("2026-03-29");
    expect(dayBefore("2026-10-26", 1)).toBe("2026-10-25");
  });
});

describe("chartDays", () => {
  it("draws thirty days ending today, oldest first", () => {
    const days = chartDays([], "2026-10-09");
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe(chartFrom("2026-10-09"));
    expect(days[0].day).toBe("2026-09-10");
    expect(days.at(-1)!.day).toBe("2026-10-09");
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  it("puts each count on its day and ignores a day outside the range", () => {
    const days = chartDays(
      [
        { day: "2026-10-09", count: 2 },
        { day: "2026-09-10", count: 1 },
        { day: "2026-09-09", count: 7 },
        { day: "2026-10-10", count: 7 },
      ],
      "2026-10-09",
    );
    expect(days.at(-1)!.count).toBe(2);
    expect(days[0].count).toBe(1);
    expect(days.reduce((s, d) => s + d.count, 0)).toBe(3);
  });

  it("adds two rows for one day, and reads a count the driver sent as words", () => {
    const days = chartDays(
      [
        { day: "2026-10-01", count: 1 },
        { day: "2026-10-01", count: "2" as unknown as number },
      ],
      "2026-10-09",
    );
    expect(days.find((d) => d.day === "2026-10-01")!.count).toBe(3);
  });
});

describe("chartSummary", () => {
  it("says today's number and the average a day, to one place", () => {
    const days = chartDays(
      [
        { day: "2026-10-09", count: 4 },
        { day: "2026-10-01", count: 3 },
      ],
      "2026-10-09",
    );
    expect(chartSummary(days)).toEqual({ today: 4, average: "0.2" });
    expect(chartSummary(chartDays([], "2026-10-09"))).toEqual({ today: 0, average: "0" });
  });
});

describe("sourceShape", () => {
  const board = {
    project: { id: "p", key: "USH", name: "Ushabti" },
    properties: [
      {
        id: "status",
        name: "Status",
        type: "select",
        options: [{ id: "done", name: "Done", color: "#4f8a5b" }],
      },
      { id: "who", name: "Assignee", type: "person", options: [] },
    ],
  } as unknown as Parameters<typeof sourceShape>[1];
  const chart = { projectId: "p", propertyId: "status", optionId: "done" };

  it("names the option and takes its colour, read afresh", () => {
    expect(sourceShape(chart, board)).toMatchObject({
      option: "Done",
      property: "Status",
      color: "#4f8a5b",
      project: { key: "USH" },
    });
  });

  it("draws nothing for an option or property that is gone, or is not a select", () => {
    expect(sourceShape({ ...chart, optionId: "gone" }, board)).toBeNull();
    expect(sourceShape({ ...chart, propertyId: "gone" }, board)).toBeNull();
    expect(sourceShape({ ...chart, propertyId: "who" }, board)).toBeNull();
  });
});

describe("A chart of several sources", () => {
  const shape = (key: string, option: string, color = "#4f8a5b") => ({
    project: { id: key, key, name: `Project ${key}` },
    propertyId: "status",
    optionId: option,
    property: "Status",
    option,
    color,
    days: [],
  });

  it("sums each day over its sources, on the first source's days, in its colour", () => {
    const chart = sumChart(
      "c",
      [
        {
          shape: shape("USH", "Done", "#111111"),
          rows: [
            { day: "2026-10-09", count: 3 },
            { day: "2026-10-01", count: 1 },
          ],
        },
        { shape: shape("SET", "Done", "#222222"), rows: [{ day: "2026-10-09", count: 2 }] },
      ],
      "2026-10-09",
    )!;
    expect(chart.color).toBe("#111111");
    expect(chart.days).toHaveLength(30);
    expect(chart.days.at(-1)).toEqual({ day: "2026-10-09", count: 5 });
    expect(chart.sources.map((s) => s.days.at(-1)!.count)).toEqual([3, 2]);
    expect(chartSummary(chart.days)).toEqual({ today: 5, average: "0.2" });
    expect(chartSplit(chart, 29)).toBe("USH 3, SET 2");
    expect(sumChart("c", [], "2026-10-09")).toBeNull();
  });

  it("names every key and each option once; one source reads as it always did", () => {
    const one = { sources: [shape("USH", "Done")] };
    expect(chartHeading(one)).toEqual({
      keys: "USH",
      options: "Done",
      title: "USH Entered Done",
    });
    expect(chartSplit(one, 0)).toBeNull();
    expect(chartHint(one)).toBe("Status in Project USH");
    expect(chartHeading({ sources: [shape("USH", "Done"), shape("SET", "Done")] }).title).toBe(
      "USH · SET Entered Done",
    );
    expect(chartHeading({ sources: [shape("USH", "Done"), shape("SET", "Shipped")] }).title).toBe(
      "USH · SET Entered Done, Shipped",
    );
  });

  it("is the same chart whatever order its sources are in", () => {
    const a = { projectId: "p", propertyId: "s", optionId: "o" };
    const b = { projectId: "q", propertyId: "s", optionId: "o" };
    expect(sameSources([a, b], [b, a])).toBe(true);
    expect(sameSources([a], [a, b])).toBe(false);
    expect(sameSources([a, b], [a, { ...b, optionId: "x" }])).toBe(false);
  });
});
