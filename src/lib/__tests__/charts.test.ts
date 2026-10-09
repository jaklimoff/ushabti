import { describe, expect, it } from "vitest";
import { chartDays, chartFrom, chartShape, chartSummary, dayBefore } from "@/lib/charts";

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

describe("chartShape", () => {
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
  } as unknown as Parameters<typeof chartShape>[1];
  const chart = { id: "c", projectId: "p", propertyId: "status", optionId: "done" };

  it("names the option and takes its colour, read afresh", () => {
    expect(chartShape(chart, board)).toMatchObject({
      option: "Done",
      property: "Status",
      color: "#4f8a5b",
      project: { key: "USH" },
    });
  });

  it("draws nothing for an option or property that is gone, or is not a select", () => {
    expect(chartShape({ ...chart, optionId: "gone" }, board)).toBeNull();
    expect(chartShape({ ...chart, propertyId: "gone" }, board)).toBeNull();
    expect(chartShape({ ...chart, propertyId: "who" }, board)).toBeNull();
  });
});
