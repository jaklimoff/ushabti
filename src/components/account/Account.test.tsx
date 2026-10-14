import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard, type Answer } from "@/test/board";
import { Account } from "./Account";

/*
 * What the account page draws, and what a pick or a press sends. Each test
 * was a test of `e2e/account.spec.ts` or `e2e/password-fill.spec.ts`, and
 * names it. What the server keeps and refuses is `account-route.test.ts`; the
 * walk from the user menu to a renamed board stayed end to end.
 */

const ME_PATH = "/api/auth/me";
const PASSWORD = "/api/auth/password";

/** The routes the page calls, with what each answers. */
function serving(more: Answer = () => undefined): Answer {
  return (sent) => {
    const said = more(sent);
    if (said) return said;
    if (sent.path === "/api/auth/sessions") return { body: { others: 0 } };
    if (sent.path === ME_PATH) return { body: { user: {} } };
  };
}

async function draw(emoji: string | null = null, answer?: Answer) {
  const drawn = await renderWithBoard(
    <Account user={{ ...ME, emoji, askMail: true }} version="0.0.0" askMailOn={false} />,
    newProject(),
    serving(answer),
  );
  const patches = () => drawn.sent("PATCH", /^\/api\/auth\/me$/).map((s) => s.body);
  return { ...drawn, patches };
}

const faces = () => page.getByRole("radiogroup", { name: "Your face" });
const picked = (radio: Locator) => expect.element(radio).toHaveAttribute("aria-checked", "true");

/**
 * A password manager that writes straight onto the box, with no event React
 * hears. Was `fillWithNoEvent` of `e2e/password-fill.spec.ts`.
 */
function fillWithNoEvent(box: Locator, value: string) {
  (box.element() as HTMLInputElement).value = value;
}

describe("Your own account", () => {
  // The screen half of e2e "a name and a colour can be changed, and the board follows".
  test("a name and a colour can be changed", async () => {
    const { patches } = await draw();
    await expect.element(page.getByText(ME.email)).toBeVisible();

    const name = page.getByLabelText("Your name");
    await name.fill("Ada Lovelace");
    (name.element() as HTMLInputElement).blur();
    await expect.poll(patches).toEqual([{ name: "Ada Lovelace" }]);
    await expect.element(page.getByTestId("toast")).toHaveTextContent("Saved.");

    // The palette, and all of it but the grey that reads as nobody.
    const swatches = page.getByRole("radiogroup", { name: "Your colour" }).getByRole("radio");
    await expect.poll(() => swatches.all().length).toBe(11);
    await expect
      .element(page.getByRole("radio", { name: "Colour #8b8f98" }))
      .not.toBeInTheDocument();
    const other = swatches.elements().find((s) => s.getAttribute("aria-checked") === "false")!;
    const label = other.getAttribute("aria-label")!;
    await page.getByRole("radio", { name: label }).click();
    await picked(page.getByRole("radio", { name: label }));
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1]).toEqual({ color: label.replace("Colour ", "") });
  });

  // The screen half of e2e "a face can be an emoji, and Initials brings the initials back".
  test("a face can be an emoji, and Initials brings the initials back", async () => {
    const { patches } = await draw();
    await picked(faces().getByRole("radio", { name: "Initials" }));

    await faces().getByRole("radio", { name: "Face 🦊" }).click();
    await picked(faces().getByRole("radio", { name: "Face 🦊" }));
    await expect.poll(patches).toEqual([{ emoji: "🦊" }]);

    await faces().getByRole("radio", { name: "Initials" }).click();
    await picked(faces().getByRole("radio", { name: "Initials" }));
    await expect.poll(patches).toEqual([{ emoji: "🦊" }, { emoji: null }]);
  });

  // Was e2e "a quick pick back to the first face is still saved".
  test("a quick pick back to the first face is still saved", async () => {
    const { patches } = await draw();
    await faces().getByRole("radio", { name: "Face 🦊" }).click();
    await faces().getByRole("radio", { name: "Initials" }).click();
    await expect.poll(patches).toEqual([{ emoji: "🦊" }, { emoji: null }]);
    await picked(faces().getByRole("radio", { name: "Initials" }));
  });

  // The screen half of e2e "a face set through the API and not on the grid still shows as picked".
  test("a face set through the API and not on the grid still shows as picked", async () => {
    const pair = "🧑🏿‍🤝‍🧑🏻";
    await draw(pair);
    await picked(faces().getByRole("radio", { name: `Face ${pair}` }));
    expect(faces().elements()[0].querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
  });

  // Was e2e "any one emoji typed in the box becomes the face, and other text saves nothing".
  test("any one emoji typed in the box becomes the face, and other text saves nothing", async () => {
    const { patches } = await draw();
    const box = page.getByRole("textbox", { name: "Or type any emoji" });
    const once = page.getByText("One emoji only.");

    for (const text of ["😀😀", "ab", "🏽"]) {
      await box.fill(text);
      await expect.element(once).toBeVisible();
    }
    await box.fill("");
    await expect.element(once).not.toBeInTheDocument();
    expect(patches()).toEqual([]);

    const face = "🧑‍🚀";
    await box.fill(face);
    await expect.poll(patches).toEqual([{ emoji: face }]);
    await expect.element(box).toHaveValue("");
    await picked(faces().getByRole("radio", { name: `Face ${face}` }));
    await expect.element(once).not.toBeInTheDocument();
  });

  // The screen half of e2e "the password needs the old one, and says so when it is wrong".
  test("the password needs the old one, and says so when it is wrong", async () => {
    const { sent } = await draw(null, ({ path, body }) => {
      if (path !== PASSWORD) return;
      if ((body as { current: string }).current !== "ushabti-secret") {
        return { status: 403, body: { error: "That is not the password you use now." } };
      }
      return { body: { ok: true } };
    });
    await page.getByLabelText("The password you use now").fill("not-the-password");
    await page.getByLabelText("The password you want").fill("a-longer-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect.element(page.getByText("That is not the password you use now.")).toBeVisible();

    await page.getByLabelText("The password you use now").fill("ushabti-secret");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect.element(page.getByText("Password changed.")).toBeVisible();
    expect(sent("POST", /^\/api\/auth\/password$/).map((s) => s.body)).toEqual([
      { current: "not-the-password", next: "a-longer-secret" },
      { current: "ushabti-secret", next: "a-longer-secret" },
    ]);
  });

  // Was e2e "each password box has the eye the sign-in page has".
  test("each password box has the eye the sign-in page has", async () => {
    await draw();

    // No worded button any more: one reveal reads one way everywhere.
    await expect
      .element(page.getByRole("button", { name: /the passwords/ }))
      .not.toBeInTheDocument();

    for (const [field, what] of [
      ["The password you use now", "the current password"],
      ["The password you want", "the new password"],
    ]) {
      const box = page.getByLabelText(field);
      await box.fill("a-long-secret");
      await expect.element(box).toHaveAttribute("type", "password");

      const show = page.getByRole("button", { name: `Show ${what}` });
      await expect.element(show).toHaveAttribute("aria-pressed", "false");
      await expect.element(show).toHaveTextContent("");
      await expect.element(show.element().querySelector("svg")!).toBeVisible();

      await show.click();
      await expect.element(box).toHaveAttribute("type", "text");
      await expect.element(box).toHaveValue("a-long-secret");

      const hide = page.getByRole("button", { name: `Hide ${what}` });
      await expect.element(hide).toHaveAttribute("aria-pressed", "true");
      await hide.click();
      await expect.element(box).toHaveAttribute("type", "password");
    }

    // Each eye answers for its own box.
    await page.getByRole("button", { name: "Show the new password" }).click();
    await expect
      .element(page.getByLabelText("The password you want"))
      .toHaveAttribute("type", "text");
    await expect
      .element(page.getByLabelText("The password you use now"))
      .toHaveAttribute("type", "password");
  });

  // Was e2e/password-fill.spec.ts "survives typing in the other box on the account page, both ways".
  test("a password filled with no event survives typing in the other box, both ways", async () => {
    const { sent } = await draw(null, ({ path }) =>
      path === PASSWORD ? { body: { ok: true } } : undefined,
    );
    const now = page.getByLabelText("The password you use now");
    const want = page.getByLabelText("The password you want");
    const change = page.getByRole("button", { name: "Change password" });
    const posts = () => sent("POST", /^\/api\/auth\/password$/).map((s) => s.body);

    // The button cannot tell an empty box from a filled one, so it says it.
    await change.click();
    await expect.element(page.getByText("Type the password you use now.")).toBeVisible();
    await expect.element(now).toHaveAttribute("aria-invalid", "true");

    fillWithNoEvent(now, "ushabti-secret");
    await want.fill("a-second-secret");
    await expect.element(now).toHaveValue("ushabti-secret");
    await change.click();
    await expect.element(page.getByText("Password changed.")).toBeVisible();
    await expect.element(now).toHaveValue("");
    await expect.element(want).toHaveValue("");
    expect(posts()).toEqual([{ current: "ushabti-secret", next: "a-second-secret" }]);

    fillWithNoEvent(want, "a-third-secret");
    await now.fill("a-second-secret");
    await expect.element(want).toHaveValue("a-third-secret");
    await change.click();
    await expect.poll(() => posts().length).toBe(2);
    expect(posts()[1]).toEqual({ current: "a-second-secret", next: "a-third-secret" });
    await expect.element(want).toHaveValue("");
  });
});
