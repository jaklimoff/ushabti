import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The attachment routes, driven with the rows, the caller and the bucket's
 * answers faked. The URLs are signed for real, with keys that reach nothing,
 * so a test reads what a PUT and a GET are bound to.
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";
const MEMBER = { id: "u-member", name: "Mia", kind: "human", tokenProjectId: null };
const ADMIN = { id: "u-admin", name: "Ada", kind: "human", tokenProjectId: null };

const fake = vi.hoisted(() => ({
  actor: null as null | Record<string, unknown>,
  /** project → user → role */
  members: new Map<string, Map<string, string>>(),
  rows: new Map<string, Record<string, unknown>>(),
  head: null as null | { size: number; mime: string },
  bytes: new Uint8Array(),
  removed: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/events", () => ({ publish: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  taskProjectId: async (id: string) => (id === TASK ? PROJECT : null),
  touchTasks: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    requireActor: async () => {
      if (!fake.actor) throw new real.HttpError(401, "Sign in first, or send an agent token.");
      return fake.actor;
    },
    requireMembership: async (userId: string, projectId: string) => {
      const role = fake.members.get(projectId)?.get(userId);
      if (!role) throw new real.HttpError(404, "Project not found.");
      return { projectId, role };
    },
  };
});
vi.mock("@/lib/attachment-rows", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/attachment-rows")>();
  return {
    toAttachmentDTO: real.toAttachmentDTO,
    attachmentRow: async (id: string) => fake.rows.get(id) ?? null,
    insertAttachment: async (row: Record<string, unknown>) => {
      const made = { width: null, height: null, createdAt: new Date(), readyAt: null, ...row };
      fake.rows.set(row.id as string, made);
      return made;
    },
    markReady: async (id: string, size: { width: number | null; height: number | null }) => {
      const row = fake.rows.get(id);
      if (!row || row.readyAt) return null;
      Object.assign(row, size, { readyAt: new Date() });
      return row;
    },
    listReady: async (taskId: string) =>
      [...fake.rows.values()].filter((r) => r.taskId === taskId && r.readyAt),
    deleteRow: async (id: string) => {
      const row = fake.rows.get(id) ?? null;
      fake.rows.delete(id);
      return row;
    },
  };
});
vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...real,
    headObject: async () => fake.head,
    readHead: async () => fake.bytes,
    removeObject: async (key: string) => void fake.removed.push(key),
  };
});

const { logActivity } = await import("@/lib/activity");
const { FILES_OFF_NOTE } = await import("@/lib/attachments");
const taskRoute = await import("@/app/api/tasks/[taskId]/attachments/route");
const fileRoute = await import("@/app/api/attachments/[id]/route");
const readyRoute = await import("@/app/api/attachments/[id]/ready/route");

const logged = vi.mocked(logActivity);
const S3 = {
  S3_ENDPOINT: "http://minio:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "ushabti",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio-secret",
  S3_FORCE_PATH_STYLE: "1",
  ATTACHMENT_MAX_BYTES: "",
  ATTACHMENT_MIMES: "",
};

function stub(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

const taskCtx = { params: Promise.resolve({ taskId: TASK }) };
const fileCtx = (id = ID) => ({ params: Promise.resolve({ id }) });

function post(name: string, mime: string, size: number) {
  return taskRoute.POST(
    new Request(`http://x/api/tasks/${TASK}/attachments`, {
      method: "POST",
      body: JSON.stringify({ name, mime, size }),
    }),
    taskCtx,
  );
}

const ready = (id = ID) =>
  readyRoute.POST(
    new Request(`http://x/api/attachments/${id}/ready`, { method: "POST" }),
    fileCtx(id),
  );
const read = (id = ID) => fileRoute.GET(new Request(`http://x/api/attachments/${id}`), fileCtx(id));
const remove = (id = ID) =>
  fileRoute.DELETE(
    new Request(`http://x/api/attachments/${id}`, { method: "DELETE" }),
    fileCtx(id),
  );

/** A row as an upload leaves it, under the member, not yet ready. */
function seed(over: Record<string, unknown> = {}) {
  const row = {
    id: ID,
    projectId: PROJECT,
    taskId: TASK,
    uploaderId: MEMBER.id,
    key: `projects/${PROJECT}/${ID}`,
    name: "shot.png",
    mime: "image/png",
    size: 33,
    width: null,
    height: null,
    createdAt: new Date(),
    readyAt: null,
    ...over,
  };
  fake.rows.set(row.id, row);
  return row;
}

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 128, 0, 0,
  1, 224,
]);

beforeEach(() => {
  stub(S3);
  fake.actor = MEMBER;
  fake.members = new Map([
    [
      PROJECT,
      new Map([
        [MEMBER.id, "member"],
        [ADMIN.id, "admin"],
      ]),
    ],
  ]);
  fake.rows.clear();
  fake.head = null;
  fake.bytes = new Uint8Array();
  fake.removed = [];
  logged.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/tasks/{taskId}/attachments", () => {
  it("writes a row not yet ready and hands back a PUT bound to the mime and the length", async () => {
    const res = await post("shot.png", "image/png", 1234);
    expect(res.status).toBe(201);
    const answer = (await res.json()) as { id: string; uploadUrl: string; headers: object };
    expect(answer.headers).toEqual({ "Content-Type": "image/png" });

    const row = fake.rows.get(answer.id)!;
    expect(row).toMatchObject({
      projectId: PROJECT,
      taskId: TASK,
      uploaderId: MEMBER.id,
      key: `projects/${PROJECT}/${answer.id}`,
      name: "shot.png",
      mime: "image/png",
      size: 1234,
      readyAt: null,
    });

    const url = new URL(answer.uploadUrl);
    expect(url.origin + url.pathname).toBe(
      `http://minio:9000/ushabti/projects/${PROJECT}/${answer.id}`,
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    // Nothing is on the feed until the bytes are there.
    expect(logged).not.toHaveBeenCalled();
  });

  it("refuses a mime off the list and a file over the cap, and writes nothing", async () => {
    const pdf = await post("a.pdf", "application/pdf", 10);
    expect(pdf.status).toBe(400);
    expect(await pdf.json()).toEqual({ error: "This board does not take application/pdf files." });

    const svg = await post("a.svg", "image/svg+xml", 10);
    expect(svg.status).toBe(400);

    const big = await post("a.mp4", "video/mp4", 50 * 1024 * 1024 + 1);
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ error: "A file is at most 50 MiB." });
    expect(fake.rows.size).toBe(0);
  });

  it("refuses a stranger", async () => {
    fake.actor = { id: "u-stranger", kind: "human", tokenProjectId: null };
    expect((await post("shot.png", "image/png", 10)).status).toBe(404);
    expect(fake.rows.size).toBe(0);
  });
});

describe("POST /api/attachments/{id}/ready", () => {
  it("checks the object, reads the size of an image and writes it to the feed", async () => {
    seed();
    fake.head = { size: 33, mime: "image/png" };
    fake.bytes = PNG;
    const res = await ready();
    expect(res.status).toBe(200);
    expect(fake.rows.get(ID)).toMatchObject({ width: 640, height: 480 });
    expect(fake.rows.get(ID)!.readyAt).toBeInstanceOf(Date);
    expect(logged).toHaveBeenCalledWith({
      projectId: PROJECT,
      taskId: TASK,
      actorId: MEMBER.id,
      kind: "attachment",
      data: { action: "added", attachmentId: ID, name: "shot.png" },
    });
  });

  it("leaves a video without a size", async () => {
    seed({ mime: "video/mp4", name: "clip.mp4" });
    fake.head = { size: 33, mime: "video/mp4" };
    expect((await ready()).status).toBe(200);
    expect(fake.rows.get(ID)).toMatchObject({ width: null, height: null });
  });

  it("takes an image type the server added, without a size", async () => {
    stub({ ATTACHMENT_MIMES: "image/avif" });
    seed({ mime: "image/avif", name: "a.avif" });
    fake.head = { size: 33, mime: "image/avif" };
    fake.bytes = new TextEncoder().encode("not a format this server reads");
    expect((await ready()).status).toBe(200);
    expect(fake.rows.get(ID)).toMatchObject({ width: null, height: null });
  });

  it("refuses when the bucket holds nothing, another length or another mime", async () => {
    seed();
    expect((await ready()).status).toBe(409);
    fake.head = { size: 34, mime: "image/png" };
    expect((await ready()).status).toBe(409);
    fake.head = { size: 33, mime: "text/html" };
    expect((await ready()).status).toBe(409);
    expect(fake.rows.get(ID)!.readyAt).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it("refuses an image whose bytes are not that image", async () => {
    seed();
    fake.head = { size: 33, mime: "image/png" };
    fake.bytes = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect((await ready()).status).toBe(422);
    expect(fake.rows.get(ID)!.readyAt).toBeNull();
  });

  it("is the uploader's to say", async () => {
    seed();
    fake.head = { size: 33, mime: "image/png" };
    fake.bytes = PNG;
    fake.actor = ADMIN;
    expect((await ready()).status).toBe(403);
  });
});

describe("GET /api/attachments/{id}", () => {
  it("redirects a member to a GET signed for five minutes", async () => {
    seed({ readyAt: new Date() });
    const res = await read();
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe(`/ushabti/projects/${PROJECT}/${ID}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-type")).toBe("image/png");
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^inline;/);
  });

  it("serves SVG as a download, never inline", async () => {
    stub({ ATTACHMENT_MIMES: "image/svg+xml" });
    seed({ mime: "image/svg+xml", name: "logo.svg", readyAt: new Date() });
    const url = new URL((await read()).headers.get("location")!);
    expect(url.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
  });

  it("refuses a stranger, and a token for another project", async () => {
    seed({ readyAt: new Date() });
    fake.actor = { id: "u-stranger", kind: "human", tokenProjectId: null };
    const stranger = await read();
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get("location")).toBeNull();

    fake.actor = { id: "u-agent", kind: "agent", tokenProjectId: OTHER };
    fake.members.get(PROJECT)!.set("u-agent", "member");
    expect((await read()).status).toBe(403);

    fake.actor = null;
    expect((await read()).status).toBe(401);
  });

  it("does not serve an upload nobody confirmed", async () => {
    seed();
    expect((await read()).status).toBe(404);
  });
});

describe("DELETE /api/attachments/{id}", () => {
  it("lets the uploader remove the row and the object, and writes it to the feed", async () => {
    seed({ readyAt: new Date() });
    expect((await remove()).status).toBe(200);
    expect(fake.rows.has(ID)).toBe(false);
    expect(fake.removed).toEqual([`projects/${PROJECT}/${ID}`]);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "attachment",
        data: expect.objectContaining({ action: "removed" }),
      }),
    );
  });

  it("lets an admin remove anybody's, and refuses another member", async () => {
    seed({ readyAt: new Date(), uploaderId: "u-other" });
    expect((await remove()).status).toBe(403);
    expect(fake.rows.has(ID)).toBe(true);
    fake.actor = ADMIN;
    expect((await remove()).status).toBe(200);
  });
});

describe("GET /api/tasks/{taskId}/attachments", () => {
  it("lists only the ready files", async () => {
    seed({ readyAt: new Date() });
    seed({ id: "55555555-5555-4555-8555-555555555555" });
    const res = await taskRoute.GET(new Request(`http://x/api/tasks/${TASK}/attachments`), taskCtx);
    const answer = (await res.json()) as { attachments: Array<{ id: string; url: string }> };
    expect(answer.attachments.map((a) => a.id)).toEqual([ID]);
    expect(answer.attachments[0].url).toBe(`/api/attachments/${ID}`);
  });
});

describe("with no bucket", () => {
  it("answers 503 with one sentence on every route", async () => {
    stub({ S3_BUCKET: "" });
    seed({ readyAt: new Date() });
    const answers = await Promise.all([
      post("shot.png", "image/png", 10),
      taskRoute.GET(new Request(`http://x/api/tasks/${TASK}/attachments`), taskCtx),
      ready(),
      read(),
      remove(),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Attachments are off, because this server has no S3 bucket set.",
      });
    }
    expect(fake.rows.has(ID)).toBe(true);
  });

  it("gives Settings one line to say what to set", () => {
    expect(FILES_OFF_NOTE).toBe("Set S3_BUCKET and its keys to let people attach files.");
  });
});
