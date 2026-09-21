import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addTask, createProject, inDatabase, register, unique } from "./helpers";

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

  /*
   * An address the board refuses. The scheme rule holds whatever
   * USHABTI_WEBHOOK_PRIVATE says, so this test reads the same on a machine
   * where a loopback receiver is allowed — which is every machine that runs
   * this suite.
   */
  test("a URL the board will not call is refused in the row, with no dialog", async ({ page }) => {
    await register(page, "Owner Person");
    const projectId = await createProject(page, unique("Refused"));
    await page.goto(`/p/${projectId}/settings/webhooks`);

    await page.getByLabel("URL of the new webhook").fill("ftp://example.com/hook");
    await page.getByRole("button", { name: "Add webhook" }).click();

    const said = page.getByTestId("webhook-error");
    await expect(said).toBeVisible();
    await expect(said).toHaveText(/starts with http/);
    // Nothing was made, and nothing opened on top of the page.
    await expect(page.getByTestId("webhook-box")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Typing again takes the sentence away, and a real URL is taken.
    await page.getByLabel("URL of the new webhook").fill("https://example.com/hook");
    await expect(said).toHaveCount(0);
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.getByTestId("webhook-box")).toHaveCount(1);
  });

  /*
   * Turning a webhook off has to stop the deliveries already queued behind
   * it, not only the next one. The delivery is written straight into the
   * table so that the row is waiting while the webhook is switched, which a
   * click on the board is too quick to arrange.
   */
  test("a webhook that is off does not ring what was already queued", async ({ page, request }) => {
    const hook = await receiver();
    try {
      await register(page, "Owner Person");
      const projectId = await createProject(page, unique("Switched"));
      await page.goto(`/p/${projectId}/settings/webhooks`);
      await page.getByLabel("URL of the new webhook").fill(hook.url);
      await page.getByRole("button", { name: "Add webhook" }).click();
      await expect(page.getByTestId("webhook-secret")).toBeVisible();

      await page.getByRole("button", { name: "Turn off" }).click();
      await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();

      const hookId = await inDatabase(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "select id from webhooks where project_id = $1",
          [projectId],
        );
        return rows[0].id;
      });
      const queue = () =>
        inDatabase(async (client) => {
          await client.query(
            `insert into webhook_deliveries (webhook_id, body, next_try_at)
             values ($1, $2::jsonb, now())`,
            [hookId, JSON.stringify({ delivery: "x", kind: "test" })],
          );
        });

      const cookies = await page.context().cookies();
      const jar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      /* The board read is where the sender is started, so this is the whole
         of what a drain looks like from outside. */
      const drain = async () => {
        await request.get(`/api/projects/${projectId}/board`, { headers: { cookie: jar } });
        await page.waitForTimeout(1200);
      };

      await queue();
      await drain();
      expect(hook.rings).toHaveLength(0);

      // Back on, and the one that was waiting goes out.
      await page.getByRole("button", { name: "Turn on" }).click();
      await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible();
      await drain();
      expect(hook.rings.length).toBeGreaterThan(0);
    } finally {
      await hook.stop();
    }
  });

  /*
   * The page holds still sideways on a phone, and every control on it is big
   * enough to press. Measured rather than looked at, like the other two
   * settings pages that carry a phone test.
   */
  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 780 } });

    test("the webhooks page fits the screen, chips and all", async ({ page }) => {
      const hook = await receiver();
      try {
        await register(page);
        const projectId = await createProject(page, unique("Pocket"));
        await page.goto(`/p/${projectId}/settings/webhooks`);
        await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
        expect(await overflow(page)).toBe(0);

        await page.getByLabel("URL of the new webhook").fill(hook.url);
        await page.getByRole("button", { name: "Add webhook" }).click();
        await expect(page.getByTestId("webhook-secret")).toBeVisible();

        expect(await overflow(page)).toBe(0);
        // Everything, and the ten feed words behind it.
        await forAFinger(page.getByRole("group", { name: "What rings this webhook" }), 1);
        await expect(
          page.getByRole("group", { name: "What rings this webhook" }).getByRole("button"),
        ).toHaveCount(11);
      } finally {
        await hook.stop();
      }
    });
  });
});

/** How far the page can be pushed sideways. A phone has nowhere to push it. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, 0);
  });
}

/** Every one of these is big enough for a finger, and there are as many as asked. */
async function forAFinger(rows: Locator, count: number) {
  await expect(rows).toHaveCount(count);
  for (let i = 0; i < count; i += 1) {
    const box = await rows.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(22);
  }
}
