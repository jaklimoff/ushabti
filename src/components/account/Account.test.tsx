import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { ME, newProject, renderWithBoard, type Answer } from "@/test/board";
import type { PersonalTokenDTO } from "@/lib/types";
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
    if (sent.path === "/api/auth/sessions") return { body: { others: 3 } };
    if (sent.path === "/api/auth/tokens") return { body: { tokens: [] } };
    if (sent.path === ME_PATH) return { body: { user: {} } };
  };
}

async function draw(emoji: string | null = null, answer?: Answer, askMailOn = false) {
  const drawn = await renderWithBoard(
    <Account user={{ ...ME, emoji, askMail: true }} version="0.0.0" askMailOn={askMailOn} />,
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
  test("opens with a lead line, then Profile, Email, Password, Sessions and Personal tokens", async () => {
    await draw(null, undefined, true);
    await expect
      .element(page.getByText("How you look to your team, and how you sign in."))
      .toBeVisible();
    const headings = () =>
      page
        .getByRole("heading", { level: 2 })
        .elements()
        .map((h) => h.textContent);
    await expect
      .poll(headings)
      .toEqual(["Profile", "Email", "Password", "Sessions", "Personal tokens"]);
  });

  test("with mail off there is no Email section, and the order holds", async () => {
    await draw();
    const headings = () =>
      page
        .getByRole("heading", { level: 2 })
        .elements()
        .map((h) => h.textContent);
    await expect.poll(headings).toEqual(["Profile", "Password", "Sessions", "Personal tokens"]);
  });

  // The screen half of e2e "a name and a colour can be changed, and the board follows".
  test("a name and a colour can be changed", async () => {
    const { patches } = await draw();
    await expect.element(page.getByText(ME.email)).toBeVisible();

    const name = page.getByLabelText("Your name");
    await name.fill("Ada Lovelace");
    (name.element() as HTMLInputElement).blur();
    await expect.poll(patches).toEqual([{ name: "Ada Lovelace" }]);
    // A save that worked shows itself in the preview; a toast is for what failed.
    await expect
      .poll(() => page.getByTestId("account-preview").element().textContent)
      .toContain("Ada Lovelace");
    await expect.element(page.getByTestId("toast")).not.toBeInTheDocument();

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
    // The wrong box is the one that is marked, not the new one.
    await expect
      .element(page.getByLabelText("The password you use now"))
      .toHaveAttribute("aria-invalid", "true");
    await expect
      .element(page.getByLabelText("The password you want"))
      .not.toHaveAttribute("aria-invalid");

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

  test("signing the other sessions out asks first, and names how many", async () => {
    const { sent } = await draw();
    const ends = () => sent("DELETE", /^\/api\/auth\/sessions$/);
    await expect
      .element(page.getByText("You are signed in here and in 3 other sessions."))
      .toBeVisible();

    await page.getByRole("button", { name: "Sign out the others" }).click();
    await expect
      .poll(() => page.getByRole("alertdialog").element().textContent)
      .toContain("Sign out 3 other sessions? This one stays.");
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(ends()).toEqual([]);

    await page.getByRole("button", { name: "Sign out the others" }).click();
    await page.getByRole("button", { name: "Yes, sign them out" }).click();
    await expect.poll(() => ends().length).toBe(1);
  });

  test("the question email is a tick that saves at once", async () => {
    const { patches } = await draw(null, undefined, true);
    const box = page.getByRole("checkbox", { name: /Email me when an agent asks me something/ });
    await expect.element(box).toBeChecked();
    await box.click();
    await expect.poll(patches).toEqual([{ askMail: false }]);
    await expect.element(box).not.toBeChecked();
    await expect.element(page.getByTestId("toast")).not.toBeInTheDocument();
  });

  test("a token row says when it was made and warns when it ends soon", async () => {
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const made: PersonalTokenDTO = {
      id: "t9",
      name: "Raycast",
      prefix: "ushp_77e2",
      createdAt: at(0),
      expiresAt: at(90),
      lastUsedAt: null,
    };
    const tokens: PersonalTokenDTO[] = [
      {
        id: "t1",
        name: "Laptop CLI",
        prefix: "ushp_4f9a",
        createdAt: at(-3),
        expiresAt: at(6),
        lastUsedAt: at(-1),
      },
    ];
    await draw(null, ({ path, method }) => {
      if (path !== "/api/auth/tokens") return;
      if (method === "POST") {
        tokens.unshift(made);
        return { body: { token: made, secret: "ushp_77e2secret" } };
      }
      return { body: { tokens } };
    });

    const laptop = page.getByTestId("personal-token-row").filter({ hasText: "Laptop CLI" });
    await expect
      .poll(() => laptop.element().textContent)
      .toContain("made 3 days ago · expires in 6 days · last used yesterday");

    await page.getByLabelText("Token name").fill("Raycast");
    await page.getByRole("button", { name: "Make token" }).click();
    const secret = page.getByTestId("personal-secret");
    await expect.poll(() => secret.element().textContent).toContain("ushp_77e2secret");
    // The secret sits under its own row, and the keyboard waits on Copy.
    const row = secret.element().previousElementSibling!;
    expect(row.textContent).toContain("Raycast");
    expect(row.textContent).toContain("made today");
    await expect.element(page.getByRole("button", { name: "Copy the token" })).toHaveFocus();
  });
});
