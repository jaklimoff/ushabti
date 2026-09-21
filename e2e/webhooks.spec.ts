import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { addTask, createProject, register, unique } from "./helpers";

/**
 * A webhook has to be able to reach something, so the test is the receiver.
 *
 * It is a plain `http.createServer` on a free port, started for one spec and
 * stopped after it. Nothing is added to the project's dependencies for it,
 * which is the same rule the sender itself keeps.
 */
type Ring = {
  body: string;
  headers: Record<string, string>;
};

type Receiver = {
  url: string;
  rings: Ring[];
  /** Waits for the next ring, or gives up. */
  next: (ms?: number) => Promise<Ring>;
  stop: () => Promise<void>;
};

async function receiver(answer = 200): Promise<Receiver> {
  const rings: Ring[] = [];
  let waiting: ((ring: Ring) => void) | null = null;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const ring: Ring = { body, headers: req.headers as Record<string, string> };
      rings.push(ring);
      waiting?.(ring);
      waiting = null;
      res.writeHead(answer).end("ok");
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    rings,
    next: (ms = 20_000) =>
      new Promise<Ring>((done, fail) => {
        const first = rings[0];
        if (first) return done(first);
        const timer = setTimeout(() => fail(new Error("nothing rang")), ms);
        waiting = (ring) => {
          clearTimeout(timer);
          done(ring);
        };
      }),
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** The receiver's own check, exactly as `docs/webhooks.md` writes it. */
function verify(secret: string, ring: Ring): boolean {
  const timestamp = ring.headers["x-ushabti-timestamp"];
  const signature = ring.headers["x-ushabti-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const wanted = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${ring.body}`).digest("hex"),
  );
  const given = Buffer.from(signature);
  return wanted.length === given.length && timingSafeEqual(wanted, given);
}

test.describe("Webhooks", () => {
  test("a webhook is made, tested, and the test arrives signed", async ({ page }) => {
    const hook = await receiver();
    try {
      await register(page, "Owner Person");
      const projectId = await createProject(page, unique("Hooks"));
      await page.goto(`/p/${projectId}/settings/webhooks`);

      // Nothing yet, and the page says what one is for.
      await expect(page.getByText("No webhooks yet.")).toBeVisible();

      await page.getByLabel("URL of the new webhook").fill(hook.url);
      await page.getByRole("button", { name: "Add webhook" }).click();

      // The secret is readable here and nowhere else.
      const secretBox = page.getByTestId("webhook-secret");
      await expect(secretBox).toBeVisible();
      const secret = (await secretBox.locator("code").innerText()).trim();
      expect(secret.startsWith("ushs_")).toBeTruthy();

      await expect(page.getByTestId("webhook-last")).toHaveText(/Nothing sent yet/);

      await page.getByRole("button", { name: "Send a test" }).click();

      const ring = await hook.next();
      expect(verify(secret, ring)).toBeTruthy();

      const body = JSON.parse(ring.body) as Record<string, unknown>;
      expect(body.kind).toBe("test");
      expect(body.projectId).toBe(projectId);
      expect(typeof body.delivery).toBe("string");
      expect(ring.headers["x-ushabti-delivery"]).toBe(body.delivery);

      // And the page says so without being reloaded.
      await expect(page.getByTestId("webhook-last")).toHaveText(/delivered/);
    } finally {
      await hook.stop();
    }
  });

  test("a change on the board rings, and says only what changed and where", async ({ page }) => {
    const hook = await receiver();
    try {
      await register(page, "Owner Person");
      const projectId = await createProject(page, unique("Rings"));
      await page.goto(`/p/${projectId}/settings/webhooks`);
      await page.getByLabel("URL of the new webhook").fill(hook.url);
      await page.getByRole("button", { name: "Add webhook" }).click();
      await expect(page.getByTestId("webhook-secret")).toBeVisible();

      // One task, made on the board.
      await page.goto(`/p/${projectId}`);
      await addTask(page, "Todo", "A task that rings");

      const ring = await hook.next();
      const body = JSON.parse(ring.body) as Record<string, unknown>;
      expect(body.kind).toBe("created");
      expect(body.taskKey).toMatch(/-\d+$/);
      // The doorbell, never the change: the title is not in the body.
      expect(ring.body).not.toContain("A task that rings");
    } finally {
      await hook.stop();
    }
  });

  test("a shut port never slows a write down", async ({ page, request }) => {
    await register(page, "Owner Person");
    const quiet = await createProject(page, unique("Quiet"));
    const rung = await createProject(page, unique("Rung"));

    // A port nobody is listening on. The receiver is opened to find a free
    // one and then closed, so the address is real and the connection is not.
    const shut = await receiver();
    const dead = shut.url;
    await shut.stop();

    await page.goto(`/p/${rung}/settings/webhooks`);
    await page.getByLabel("URL of the new webhook").fill(dead);
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.getByTestId("webhook-secret")).toBeVisible();

    const cookies = await page.context().cookies();
    const jar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const write = async (projectId: string, title: string) => {
      const started = Date.now();
      const res = await request.post(`/api/projects/${projectId}/tasks`, {
        headers: { cookie: jar, "content-type": "application/json" },
        data: { title },
      });
      expect(res.ok()).toBeTruthy();
      return Date.now() - started;
    };

    // Warm both routes, so the first compile is nobody's cost.
    await write(quiet, "warm");
    await write(rung, "warm");

    let plain = 0;
    let hooked = 0;
    for (let i = 0; i < 5; i += 1) {
      plain += await write(quiet, `plain ${i}`);
      hooked += await write(rung, `hooked ${i}`);
    }

    /* The sender is never awaited, so the queued INSERT is the whole cost.
       The board has a five second timeout on a try; if a write ever waited
       for one, this would be thousands of milliseconds apart rather than
       tens. The margin is wide on purpose: what is under test is that the
       network is not on this path at all, not how fast a laptop is. */
    expect(hooked - plain).toBeLessThan(1000);
  });
});
