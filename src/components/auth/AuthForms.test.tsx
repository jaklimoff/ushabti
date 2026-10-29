import { describe, expect, test } from "vitest";
import { page, type Locator } from "vitest/browser";
import { newProject, renderWithBoard } from "@/test/board";
import { AuthForm } from "./AuthForm";
import { ResetForm } from "./ResetForm";

/*
 * The eye beside a password box, and a password a manager filled with no
 * event. Each test was a test of `e2e/reveal.spec.ts` or
 * `e2e/password-fill.spec.ts`, and names it. The sign-in page's fill carries
 * `@smoke` and stayed end to end; the reset link that works once and signs in
 * is `e2e/reset.spec.ts`.
 */

const RESET = "/api/auth/reset";

async function draw(ui: React.ReactNode) {
  return renderWithBoard(ui, newProject(), ({ path }) =>
    path === RESET ? { body: { ok: true } } : undefined,
  );
}

/**
 * Was `pressAndRead` of `e2e/reveal.spec.ts`. The button was reported as
 * doing nothing, so this asks it to show and to hide, and reads the box.
 */
async function pressAndRead(box: Locator) {
  await box.fill("a-long-secret");
  await expect.element(box).toHaveAttribute("type", "password");

  const show = page.getByRole("button", { name: "Show the password" });
  await expect.element(show).toHaveAttribute("aria-pressed", "false");
  // A glyph and no word, so the name is all a screen reader has.
  await expect.element(show).toHaveTextContent("");
  await expect.element(show.element().querySelector("svg")!).toBeVisible();

  await show.click();
  await expect.element(box).toHaveAttribute("type", "text");
  await expect.element(box).toHaveValue("a-long-secret");

  const hide = page.getByRole("button", { name: "Hide the password" });
  await expect.element(hide).toHaveAttribute("aria-pressed", "true");
  await hide.click();
  await expect.element(box).toHaveAttribute("type", "password");
  await expect.element(box).toHaveValue("a-long-secret");
}

/** A password manager that writes straight onto the box, with no event React hears. */
function fillWithNoEvent(box: Locator, value: string) {
  (box.element() as HTMLInputElement).value = value;
}

describe("Showing a password", () => {
  // Was e2e/reveal.spec.ts "the eye shows and hides it on the sign-in page".
  test("the eye shows and hides it on the sign-in page", async () => {
    const { sent } = await draw(<AuthForm mode="login" />);
    await pressAndRead(page.getByLabelText("Your password"));

    // It is a button in a form, so it must never send the form.
    await expect
      .element(page.getByRole("button", { name: /the password/ }))
      .toHaveAttribute("type", "button");
    expect(sent("POST")).toEqual([]);
  });

  // Was e2e/reveal.spec.ts "the eye shows and hides it on the reset page".
  test("the eye shows and hides it on the reset page", async () => {
    const { sent } = await draw(<ResetForm token="ushr_abc" />);
    await pressAndRead(page.getByLabelText("Your new password"));
    expect(sent("POST")).toEqual([]);
  });
});

describe("A password filled with no event", () => {
  // Was e2e/password-fill.spec.ts "survives the eye on the reset page, and sets the password".
  test("survives the eye on the reset page, and sets the password", async () => {
    const { sent } = await draw(<ResetForm token="ushr_abc" />);
    const box = page.getByLabelText("Your new password");
    fillWithNoEvent(box, "a-filled-secret");

    await page.getByRole("button", { name: "Show the password" }).click();
    await expect.element(box).toHaveAttribute("type", "text");
    await expect.element(box).toHaveValue("a-filled-secret");
    await page.getByRole("button", { name: "Hide the password" }).click();
    await expect.element(box).toHaveAttribute("type", "password");
    await expect.element(box).toHaveValue("a-filled-secret");

    await page.getByRole("button", { name: "Set the password" }).click();
    await expect.poll(() => sent("POST", /^\/api\/auth\/reset$/).length).toBe(1);
    expect(sent("POST", /^\/api\/auth\/reset$/)[0].body).toEqual({
      token: "ushr_abc",
      password: "a-filled-secret",
    });
  });
});

describe("A form that says what is wrong on the box", () => {
  test("an empty sign-up names each box and sends nothing", async () => {
    const { sent } = await draw(<AuthForm mode="register" />);
    await page.getByLabelText("Your password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect.element(page.getByText("Type your name.")).toBeVisible();
    await expect.element(page.getByText("Type your email.")).toBeVisible();
    await expect.element(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect.element(page.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    await expect.element(page.getByLabelText("Your name")).toHaveFocus();
    expect(sent("POST")).toEqual([]);
  });

  test("the sign-in page always offers Forgot password?", async () => {
    await draw(<AuthForm mode="login" forgotOn={false} />);
    await expect
      .element(page.getByRole("link", { name: "Forgot password?" }))
      .toHaveAttribute("href", "/forgot");
  });

  test("a click on the label puts the cursor in the box", async () => {
    await draw(<AuthForm mode="login" />);
    await page.getByText("Password", { exact: true }).click();
    await expect.element(page.getByLabelText("Your password")).toHaveFocus();
  });
});

describe("What the outside offers", () => {
  test("a closed board offers no sign-up page from sign in", async () => {
    await draw(<AuthForm mode="login" signupOpen={false} />);
    await expect
      .element(page.getByText("New here? Open the invite link an admin sent you."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Create an account" }))
      .not.toBeInTheDocument();
  });

  test("an open board links to sign up", async () => {
    await draw(<AuthForm mode="login" />);
    await expect
      .element(page.getByRole("link", { name: "Create an account" }))
      .toHaveAttribute("href", "/register");
  });

  test("an invite says Join, and whose account it opens", async () => {
    await draw(
      <AuthForm
        mode="register"
        invite={{ token: "ushi_abc", email: "ada@example.com", project: "Engine" }}
      />,
    );
    await expect.element(page.getByRole("heading", { name: "Join Engine" })).toBeVisible();
    await expect
      .element(page.getByTestId("invite-tagline"))
      .toHaveTextContent("Invited as ada@example.com. Your account opens Engine at once.");
    await expect
      .element(page.getByRole("button", { name: "Create account and join" }))
      .toBeVisible();
  });
});
