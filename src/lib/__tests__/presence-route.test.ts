import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, call, person, project } = await import("@/test/route");

/*
 * Who may say they have a task open. This was a test of
 * `e2e/presence.spec.ts`, and carries its name. Two people, the dying tab and
 * the phone's faces are the stream's and the panel's.
 */

describe("Who else has the task open", () => {
  it("an agent may not say it has a task open", async () => {
    const owner = await person("Owner Person");
    const p = await project(owner);
    const bot = await agent(owner, p.id);
    const say = (who: typeof owner) =>
      call(
        { ...who, headers: { ...who.headers, "x-ushabti-client": randomUUID() } },
        "POST",
        `/api/projects/${p.id}/presence`,
        { taskId: null, field: null },
      );

    expect((await say(bot.caller)).status).toBe(403);
    // The same door is open to a person, so the refusal is the agent's.
    expect((await say(owner)).status).toBe(200);
  });
});
