import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { agent, api, join, ok, person, project, task } = await import("@/test/route");

/*
 * The whole project as one file. This was the test of `e2e/export.spec.ts`,
 * and carries its name. That the member's Settings page draws no Download is
 * `ProjectPanel.test.tsx`; the file's shape is `export.test.ts`.
 */

type ExportFile = {
  format: string;
  tasks: {
    title: string;
    archivedAt: string | null;
    checklist: { text: string }[];
    comments: { body: string }[];
    blockedBy: string[];
  }[];
};

describe("Export", () => {
  it("an admin downloads the project; a member is not offered it and an agent is refused", async () => {
    const owner = await person("Olga Owner");
    const admin = await person("Ada Admin");
    const member = await person("Bob Member");
    const p = await project(owner);
    await join(p.id, admin, "admin");
    await join(p.id, member, "member");
    const as = api(owner);

    const live = await task(owner, p.id, "Write the export");
    await ok(as.post(`/api/tasks/${live.id}/comments`, { body: "Started on it." }));
    await ok(as.post(`/api/tasks/${live.id}/checklist`, { text: "Pick the fields" }));
    const old = await task(owner, p.id, "An old idea");
    await ok(as.post(`/api/tasks/${old.id}/archive`));
    /* A deleted task was a mistake, so neither it nor what hangs off it is in
       the file — not even as a blocker of a task that is. */
    const gone = await task(owner, p.id, "A mistake");
    await ok(as.post(`/api/tasks/${gone.id}/comments`, { body: "Never mind." }));
    await ok(as.post(`/api/tasks/${live.id}/blockers`, { blockerId: gone.id }));
    await ok(as.del(`/api/tasks/${gone.id}`));

    /* ---- the admin saves the file ------------------------------------- */

    const saved = await api(admin).get(`/api/projects/${p.id}/export`);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-disposition")).toMatch(
      /^attachment; filename="ushabti-[A-Z0-9]+-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const file = (await saved.json()) as ExportFile;
    expect(file.format).toBe("ushabti-export");
    const written = file.tasks.find((t) => t.title === "Write the export");
    expect(written?.archivedAt).toBeNull();
    expect(written?.comments.map((c) => c.body)).toEqual(["Started on it."]);
    expect(written?.checklist.map((c) => c.text)).toEqual(["Pick the fields"]);
    expect(file.tasks.find((t) => t.title === "An old idea")?.archivedAt).toBeTruthy();
    expect(file.tasks.find((t) => t.title === "A mistake")).toBeUndefined();
    expect(written?.blockedBy).toEqual([]);
    expect(JSON.stringify(file)).not.toContain("Never mind.");

    /* ---- the door is shut to a member, and to an agent's token --------- */

    expect((await api(member).get(`/api/projects/${p.id}/export`)).status).toBe(403);
    const bot = await agent(owner, p.id, "Helper");
    expect((await bot.api.get(`/api/projects/${p.id}/export`)).status).toBe(403);
  });
});
