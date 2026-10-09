import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => import("@/test/db"));
vi.mock("next/headers", () => import("@/test/headers"));

const { api, board, ok, person, project } = await import("@/test/route");

/*
 * The server's half of a dated column that reads as a release. Each test was
 * a test of `e2e/progress.spec.ts`. The header, its sum and its phone width
 * are in `Progress.test.tsx`, and the sums themselves in `progress.test.ts`.
 */

type Read = {
  project: { progressBy: string | null };
  properties: { id: string; name: string }[];
};

async function setUp() {
  const owner = await person("Progress Owner");
  const p = await project(owner);
  const me = api(owner);
  await ok(me.post(`/api/projects/${p.id}/properties`, { name: "Points", type: "number" }));
  await ok(
    me.post(`/api/projects/${p.id}/properties`, {
      name: "Version",
      type: "select",
      options: ["v1", "v2"],
    }),
  );
  const read = async () => (await board(owner, p.id)) as Read;
  const property = async (name: string) => (await read()).properties.find((x) => x.name === name)!;
  return { project: p, me, read, property };
}

describe("A dated column reads as a release", () => {
  it("a name that is not a number property is refused", async () => {
    const { project: p, me, read, property } = await setUp();
    const version = await property("Version");
    const res = await me.patch(`/api/projects/${p.id}`, { progressBy: version.id });
    expect(res.status).toBe(400);
    expect((await read()).project.progressBy).toBeNull();
  });

  // The kept half of "counted by a number property, the header says how much".
  it("counted by a number property is kept, and Tasks clears it", async () => {
    const { project: p, me, read, property } = await setUp();
    const points = await property("Points");

    await ok(me.patch(`/api/projects/${p.id}`, { progressBy: points.id }));
    expect((await read()).project.progressBy).toBe(points.id);

    await ok(me.patch(`/api/projects/${p.id}`, { progressBy: "" }));
    expect((await read()).project.progressBy).toBeNull();
  });
});
