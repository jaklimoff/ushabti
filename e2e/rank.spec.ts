import { expect, test } from "@playwright/test";
import { createProject, register, unique } from "./helpers";
import { RANK_CAP } from "../src/lib/rank";

/** The rewrite lands at about the 187th append. This walks a little past it. */
const APPENDS = 220;

/**
 * The end of a list only ever climbs.
 *
 * Each task added to the end halves the room above the one before it, so a
 * rank grows a character every sixth append and a board that is only ever
 * appended to runs out of room at about the 190th. The next append mends the
 * tail instead of growing past the cap: one spread, one statement, under the
 * project lock.
 *
 * There is no screen for this. A person adding tasks sees nothing move,
 * because the order is kept, so the path is walked through the API and what
 * it promises is read back off the board.
 */
test.describe("Adding tasks to the end of a board", () => {
  test("mends the ranks when they run out of room", async ({ page }) => {
    test.setTimeout(120_000);
    await register(page);
    const projectId = await createProject(page, unique("Ranks"));

    const answered: string[] = [];
    for (let i = 0; i < APPENDS; i += 1) {
      const made = await page.request.post(`/api/projects/${projectId}/tasks`, {
        data: { title: `Rank ${i + 1}` },
      });
      expect(made.status()).toBe(201);
      answered.push(((await made.json()) as { task: { position: string } }).task.position);
    }

    // The ranks really did climb to the cap, and then one append answered with
    // a short rank again. That answer is the rewrite.
    expect(Math.max(...answered.map((r) => r.length))).toBe(RANK_CAP - 1);
    const mended = answered.findIndex((r, i) => i > 0 && r.length < answered[i - 1].length);
    expect(mended).toBeGreaterThan(0);

    const board = (await (await page.request.get(`/api/projects/${projectId}/board`)).json()) as {
      tasks: { title: string; position: string }[];
    };
    const ours = board.tasks.filter((t) => t.title.startsWith("Rank "));
    expect(ours).toHaveLength(APPENDS);

    /* Sorted by the order they were added, not by the rank, so the ranks have
       to say the same thing as the order rather than agree with themselves. */
    const positions = ours
      .slice()
      .sort((a, b) => Number(a.title.slice(5)) - Number(b.title.slice(5)))
      .map((t) => t.position);

    expect(new Set(positions).size).toBe(positions.length);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i - 1] < positions[i], `rank ${i} is not above rank ${i - 1}`).toBe(true);
    }
    expect(Math.max(...positions.map((r) => r.length))).toBeLessThan(RANK_CAP);
  });
});
