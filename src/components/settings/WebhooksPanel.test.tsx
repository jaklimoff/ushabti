import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import type { WebhookDTO } from "@/lib/types";
import { WEBHOOK_KINDS } from "@/lib/types";
import { refuseAddress } from "@/lib/webhook-address";
import { ME, newProject, renderWithBoard, type Answer } from "@/test/board";
import { SettingsShell } from "./SettingsShell";
import { WebhooksPanel } from "./WebhooksPanel";

/*
 * The webhooks page: the sentence of a refused URL, and the page on a phone.
 * Each test here was a test of `e2e/webhooks.spec.ts`, and its name is the
 * name it had there. The fake refuses an address by the server's own rule;
 * the calls that leave the server stayed end to end.
 */

const HOOKS = /^\/api\/projects\/[0-9a-f-]+\/webhooks$/;

/** The webhooks route: it keeps what it takes and refuses what the rule refuses. */
function hooksRoute(): Answer {
  const hooks: WebhookDTO[] = [];
  return ({ method, path, body }) => {
    if (!HOOKS.test(path)) return;
    if (method === "GET") return { body: { webhooks: hooks } };
    if (method === "POST") {
      const url = (body as { url: string }).url;
      const refused = refuseAddress(url, false);
      if (refused) return { status: 400, body: { error: refused } };
      const hook: WebhookDTO = {
        id: `00000000-0000-4000-8000-${String(hooks.length + 1).padStart(12, "0")}`,
        url,
        prefix: "ushs_abcd",
        kinds: [],
        active: true,
        createdAt: new Date().toISOString(),
        lastDelivery: null,
      };
      hooks.push(hook);
      return { status: 201, body: { webhook: hook, secret: "ushs_abcdefghijklmnop" } };
    }
  };
}

const HOOK = /^\/api\/projects\/[0-9a-f-]+\/webhooks\/[0-9a-f-]+$/;

/** The same route, and a hook's own PATCH keeps the kinds it is sent. */
function hooksWithKinds(): Answer {
  const list = hooksRoute();
  const kept: Record<string, WebhookDTO["kinds"]> = {};
  return (sent) => {
    if (sent.method === "PATCH" && HOOK.test(sent.path)) {
      const id = sent.path.split("/").at(-1)!;
      const kinds = (sent.body as { kinds?: WebhookDTO["kinds"] }).kinds;
      if (kinds) kept[id] = kinds;
      return { body: { ok: true } };
    }
    const answer = list(sent);
    if (sent.method === "GET" && answer?.body) {
      const { webhooks } = answer.body as { webhooks: WebhookDTO[] };
      return {
        body: { webhooks: webhooks.map((h) => ({ ...h, kinds: kept[h.id] ?? h.kinds })) },
      };
    }
    return answer;
  };
}

async function draw() {
  const data = newProject();
  return renderWithBoard(
    <SettingsShell initial={data} user={ME} version="test">
      <WebhooksPanel />
    </SettingsShell>,
    data,
    hooksRoute(),
  );
}

const byTestId = (id: string) => page.getByTestId(id);
const urlBox = () => page.getByLabelText("URL of the new webhook");
const add = () => page.getByRole("button", { name: "Add webhook" });

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("Webhooks", () => {
  test("a URL the board will not call is refused in the row, with no dialog", async () => {
    await draw();
    await urlBox().fill("ftp://example.com/hook");
    await add().click();

    const said = byTestId("webhook-error");
    await expect.element(said).toBeVisible();
    expect(said.element().textContent).toContain("starts with http");
    // Nothing was made, and nothing opened on top of the page.
    expect(byTestId("webhook-box").elements()).toHaveLength(0);
    expect(page.getByRole("alertdialog").elements()).toHaveLength(0);

    // Typing again takes the sentence away, and a real URL is taken.
    await urlBox().fill("https://example.com/hook");
    await expect.element(said).not.toBeInTheDocument();
    await add().click();
    await expect.poll(() => byTestId("webhook-box").elements().length).toBe(1);
  });

  /*
   * Two answers in place of fifteen pills, writing what the pills wrote:
   * every change is no kinds at all, and a kind pressed adds that one kind.
   * Asking for "only these" writes nothing, because no kinds already means
   * every change.
   */
  test("a webhook rings on every change, or only on the kinds picked", async () => {
    const data = newProject();
    const { sent } = await renderWithBoard(
      <SettingsShell initial={data} user={ME} version="test">
        <WebhooksPanel />
      </SettingsShell>,
      data,
      hooksWithKinds(),
    );
    await urlBox().fill("https://example.com/hook");
    await add().click();
    const rings = page.getByRole("group", { name: "What rings this webhook" });
    const every = rings.getByRole("button", { name: "Every change" });
    const only = rings.getByRole("button", { name: "Only these…" });
    await expect.element(every).toHaveAttribute("aria-pressed", "true");
    expect(rings.getByRole("button", { name: "Comment" }).elements()).toHaveLength(0);

    await only.click();
    await expect.element(only).toHaveAttribute("aria-pressed", "true");
    await expect.element(rings.getByText("None picked yet")).toBeVisible();
    expect(sent("PATCH", HOOK)).toEqual([]);

    await rings.getByRole("button", { name: "Comment" }).click();
    await expect.poll(() => sent("PATCH", HOOK).length).toBe(1);
    expect(sent("PATCH", HOOK)[0].body).toEqual({ kinds: ["comment"] });
    await expect
      .element(rings.getByRole("button", { name: "Comment" }))
      .toHaveAttribute("aria-pressed", "true");

    await rings.getByRole("button", { name: "Agent run" }).click();
    await expect.poll(() => sent("PATCH", HOOK).length).toBe(2);
    expect(sent("PATCH", HOOK)[1].body).toEqual({ kinds: ["comment", "run"] });

    await every.click();
    await expect.poll(() => sent("PATCH", HOOK).length).toBe(3);
    expect(sent("PATCH", HOOK)[2].body).toEqual({ kinds: [] });
    await expect.element(every).toHaveAttribute("aria-pressed", "true");
    expect(rings.getByRole("button", { name: "Comment" }).elements()).toHaveLength(0);
  });

  test("an empty address is said under the box, and nothing is sent", async () => {
    const { sent } = await draw();
    await expect.element(add()).toBeEnabled();
    await add().click();
    await expect.element(byTestId("webhook-error")).toMatchTextContent(/^Paste the address/);
    await expect.element(urlBox()).toHaveFocus();
    await expect.element(urlBox()).toHaveAttribute("aria-invalid", "true");
    expect(sent("POST", HOOKS)).toEqual([]);
  });

  /*
   * The page holds still sideways on a phone, and every control on it is big
   * enough to press.
   */
  test("the webhooks page fits the screen, chips and all", async () => {
    await page.viewport(390, 780);
    await draw();
    const overflow = () => {
      const doc = document.documentElement;
      return Math.max(doc.scrollWidth - doc.clientWidth, 0);
    };
    await expect.element(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
    expect(overflow()).toBe(0);

    await urlBox().fill("https://example.com/hook");
    await add().click();
    await expect.element(byTestId("webhook-secret")).toBeVisible();
    expect(overflow()).toBe(0);

    // Every change or only these, and the feed words behind the second.
    const rings = page.getByRole("group", { name: "What rings this webhook" });
    expect(rings.elements()).toHaveLength(1);
    expect(rings.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(22);
    expect(rings.getByRole("button").elements()).toHaveLength(2);
    await rings.getByRole("button", { name: "Only these…" }).click();
    expect(rings.getByRole("button").elements()).toHaveLength(WEBHOOK_KINDS.length + 2);
    expect(overflow()).toBe(0);

    // The URL takes a line of its own, so the address is not cut short.
    const box = byTestId("webhook-box").first().element();
    const url = box.querySelector('[aria-label^="URL of the webhook "]')!.getBoundingClientRect();
    const row = box.querySelector(":scope > div")!.getBoundingClientRect();
    const turn = [...box.querySelectorAll("button")]
      .find((b) => /^Turn (off|on)$/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))!
      .getBoundingClientRect();
    expect(url.width).toBeGreaterThan(row.width - 30);
    expect(turn.y).toBeGreaterThanOrEqual(url.y + url.height);
  });
});
