import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import type { WebhookDTO } from "@/lib/types";
import { newProject, propertyOf, renderWithBoard, type Sent } from "@/test/board";
import { PropertiesPanel } from "./PropertiesPanel";
import { ViewsPanel } from "./ViewsPanel";
import { WebhooksPanel } from "./WebhooksPanel";

/*
 * The boxes of Properties, Views and Webhooks, which the settings design pass
 * rebuilt around. Each still saves on blur, and a tab closed on a focused box
 * sends the same request on the way out, with keepalive. Project, People and
 * Types hold their own tests of the same rule.
 */

const HOOK: WebhookDTO = {
  id: "00000000-0000-4000-8000-0000000000aa",
  url: "https://example.com/hook",
  prefix: "ushs_abcd",
  kinds: [],
  active: true,
  createdAt: new Date().toISOString(),
  lastDelivery: null,
};

async function draw(panel: ReactNode) {
  const data = newProject();
  const drawn = await renderWithBoard(panel, data, ({ method, path }) => {
    if (method === "GET" && /\/webhooks$/.test(path)) return { body: { webhooks: [HOOK] } };
    if (method === "PATCH") return { body: {} };
  });
  return { data, ...drawn };
}

const patches = (sent: (method?: string) => Sent[]) => sent("PATCH");

function closeTab() {
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
}

function lastWasKeepalive() {
  const leave = vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PATCH")
    .at(-1);
  expect(leave?.[1]?.keepalive).toBe(true);
}

/** Types into a box, then saves it either by blurring it or by closing the tab. */
async function edit(label: string, words: string, how: "blur" | "close") {
  const box = page.getByLabelText(label, { exact: true });
  await box.fill(words);
  /* A click on the middle of the page can land on a row of the page, so the
     box is let go of directly. */
  if (how === "blur") (box.element() as HTMLElement).blur();
  else closeTab();
}

const cases: {
  name: string;
  panel: () => ReactNode;
  label: (data: ReturnType<typeof newProject>) => string;
  words: string;
  path: (data: ReturnType<typeof newProject>) => string;
  body: Record<string, unknown>;
}[] = [
  {
    name: "a property's name",
    panel: () => <PropertiesPanel />,
    label: () => "Name of the Priority property",
    words: "Urgency",
    path: (data) => `/api/properties/${propertyOf(data, "Priority").id}`,
    body: { name: "Urgency" },
  },
  {
    name: "an option's name",
    panel: () => <PropertiesPanel />,
    label: (data) => `Name of the option ${propertyOf(data, "Priority").options[0].name}`,
    words: "Burning",
    path: (data) => `/api/options/${propertyOf(data, "Priority").options[0].id}`,
    body: { name: "Burning" },
  },
  {
    name: "a view's name",
    panel: () => <ViewsPanel />,
    label: () => "Name of the view List",
    words: "Stages",
    path: (data) => `/api/views/${data.views.find((v) => v.name === "List")!.id}`,
    body: { name: "Stages" },
  },
  {
    name: "a webhook's address",
    panel: () => <WebhooksPanel />,
    label: () => `URL of the webhook ${HOOK.prefix}`,
    words: "https://example.com/other",
    path: (data) => `/api/projects/${data.project.id}/webhooks/${HOOK.id}`,
    body: { url: "https://example.com/other" },
  },
];

describe("A box in settings", () => {
  for (const c of cases) {
    test(`${c.name} saves on blur`, async () => {
      const { data, sent } = await draw(c.panel());
      await expect.element(page.getByLabelText(c.label(data), { exact: true })).toBeVisible();
      await edit(c.label(data), c.words, "blur");
      await expect.poll(() => patches(sent).length).toBe(1);
      expect(patches(sent)[0].path).toBe(c.path(data));
      expect(patches(sent)[0].body).toEqual(c.body);
    });

    test(`${c.name} saves on a closed tab`, async () => {
      const { data, sent } = await draw(c.panel());
      await expect.element(page.getByLabelText(c.label(data), { exact: true })).toBeVisible();
      await edit(c.label(data), c.words, "close");
      await expect.poll(() => patches(sent).length).toBe(1);
      expect(patches(sent)[0].path).toBe(c.path(data));
      expect(patches(sent)[0].body).toEqual(c.body);
      lastWasKeepalive();
    });
  }
});
