import { describe, expect, it, vi } from "vitest";
import { RANK_CAP } from "@/lib/rank";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

/** The rewrite lands at about the 187th append. This walks a little past it. */
const APPENDS = 220;

/*
 * The end of a list only ever climbs.
 *
 * Each task added to the end halves the room above the one before it, so a
 * rank grows a character every sixth append and a board that is only ever
 * appended to runs out of room at about the 190th. The next append mends the
 * tail instead of growing past the cap: one spread, one statement, under the
 * project lock. There is no screen for this, so it was always walked through
 * the create route; it was `e2e/rank.spec.ts`.
 */
describe("Adding tasks to the end of a board", { timeout: 30_000 }, () => {
  it("mends the ranks when they run out of room", async () => {
    const owner = await person();
    const p = await project(owner);

    const answered: string[] = [];
    for (let i = 0; i < APPENDS; i += 1) {
      const made = await api(owner).post(`/api/projects/${p.id}/tasks`, { title: `Rank ${i + 1}` });
      expect(made.status).toBe(201);
      answered.push((await ok<{ task: { position: string } }>(made)).task.position);
    }

    // The ranks really did climb to the cap, and then one append answered with
    // a short rank again. That answer is the rewrite.
    expect(Math.max(...answered.map((r) => r.length))).toBe(RANK_CAP - 1);
    const mended = answered.findIndex((r, i) => i > 0 && r.length < answered[i - 1].length);
    expect(mended).toBeGreaterThan(0);

    const read = (await board(owner, p.id)) as { tasks: { title: string; position: string }[] };
    const ours = read.tasks.filter((t) => t.title.startsWith("Rank "));
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
