import { describe, expect, it, vi } from "vitest";

/**
 * The door a dying heartbeat knocks on.
 *
 * `PATCH /api/runs/{id}` is a server route, so the test hands it a database
 * that writes nothing and a board that is already made up. What it reads is
 * the one decision the route makes about `lost`: whose run it is, and whether
 * that run stopped on purpose.
 */
const fake = vi.hoisted(() => {
  const chain = { set: () => chain, where: () => Promise.resolve([]) };
  let status = "running";
  return {
    db: { update: () => chain },
    runs: (next: string) => {
      status = next;
    },
    context: () => ({
      id: "run-1",
      projectId: "project-1",
      taskId: "task-1",
      agentId: "agent-1",
      status,
      control: null,
      endedAt: null,
    }),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: fake.db }));
vi.mock("@/lib/queries", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/runs", () => ({
  addLog: vi.fn(),
  beat: vi.fn(),
  loadRun: vi.fn(async () => ({
    id: "run-1",
    control: null,
    status: "lost",
    updatedAt: "2026-09-21T16:42:29.497Z",
    reportDueAt: null,
    endedAt: "2026-09-21T16:42:29.497Z",
  })),
  replaceSteps: vi.fn(),
  runContext: vi.fn(async () => fake.context()),
  setCurrentStep: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    guard: vi.fn(async () => ({
      user: { id: "agent-1", kind: "agent" },
      membership: { role: "member" },
    })),
    broadcast: vi.fn(),
  };
});

const { PATCH } = await import("@/app/api/runs/[runId]/route");

/** One report, as the agent's client sends it. */
async function report(body: unknown) {
  const req = new Request("http://board/api/runs/run-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req, { params: Promise.resolve({ runId: "run-1" }) });
  return { status: res.status, body: await res.json() };
}

describe("a lost report", () => {
  it("closes a run that was still running", async () => {
    fake.runs("running");
    const res = await report({ status: "lost", log: "the agent was stopped" });
    expect(res.status).toBe(200);
  });

  it("is refused on a hand-over, which somebody else now holds", async () => {
    fake.runs("handed_over");
    const res = await report({ status: "lost", log: "the agent was stopped" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("That run waits on purpose, so a lost report cannot end it.");
  });

  it("is refused on a run that asked a person a question", async () => {
    fake.runs("waiting");
    const res = await report({ status: "lost", log: "the agent was stopped" });
    expect(res.status).toBe(409);
  });

  it("leaves every other word a waiting run may say alone", async () => {
    // The agent that picks the work up again still reports, and the one that
    // finishes still finishes. Only `lost` is refused.
    fake.runs("waiting");
    expect((await report({ status: "running", step: "Writing the tests" })).status).toBe(200);
    expect((await report({ status: "done", log: "opened PR #124" })).status).toBe(200);
  });
});
