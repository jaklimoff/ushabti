import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that searches the archived descriptions, guarded as the board
 * read is: whoever cannot read the board cannot read this.
 */
const fake = vi.hoisted(() => ({
  refuse: false,
  searchArchived: vi.fn(async () => ({ hits: [], total: 0 })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/archive-search", () => ({ searchArchived: fake.searchArchived }));
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  const { HttpError } = await import("@/lib/auth");
  return {
    ...real,
    guard: async () => {
      if (fake.refuse) throw new HttpError(404, "Project not found.");
      return { user: { id: "u", kind: "agent" }, membership: { role: "member" } };
    },
  };
});

import { GET } from "@/app/api/projects/[projectId]/search/route";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const ask = (q: string) =>
  GET(new Request(`http://localhost/api/projects/${PROJECT}/search?q=${encodeURIComponent(q)}`), {
    params: Promise.resolve({ projectId: PROJECT }),
  });

describe("GET /api/projects/{id}/search", () => {
  beforeEach(() => {
    fake.refuse = false;
    fake.searchArchived.mockClear();
  });

  it("searches the project it was asked about, with the words it was sent", async () => {
    const res = await ask("queue survives");
    expect(res.status).toBe(200);
    expect(fake.searchArchived).toHaveBeenCalledWith(PROJECT, "queue survives");
  });

  it("answers nothing to somebody the board read would refuse", async () => {
    fake.refuse = true;
    const res = await ask("queue");
    expect(res.status).toBe(404);
    expect(fake.searchArchived).not.toHaveBeenCalled();
  });
});
