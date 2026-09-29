import { describe, expect, it } from "vitest";
import { forgotConfig, forgotIsOn, forgotLink } from "@/lib/forgot";
import { forgotMail } from "@/lib/mail";
import { deadLinkSaid, LINK_IS_DEAD } from "@/lib/reset-link";

const MAIL = { SMTP_URL: "smtp://127.0.0.1:2525", MAIL_FROM: "board@example.com" };

/** "Forgot password?" is on only with mail and a public address, and says why when it is not. */
describe("forgotConfig", () => {
  it("is off and silent with neither mail nor USHABTI_URL, as a board was before", () => {
    expect(forgotConfig({})).toEqual({ on: false, why: null });
    expect(forgotIsOn({})).toBe(false);
  });

  it("is off, and says why, with mail and no USHABTI_URL", () => {
    const config = forgotConfig({ ...MAIL, USHABTI_URL: " " });
    expect(config.on).toBe(false);
    expect(!config.on && config.why).toBe(
      "Forgot password is off: mail is on, but USHABTI_URL is not set, so the server does not know the address to put in the link.",
    );
  });

  it("is off, and says why, with USHABTI_URL and no mail", () => {
    const config = forgotConfig({ USHABTI_URL: "https://tasks.example.com" });
    expect(!config.on && config.why).toBe(
      "Forgot password is off: USHABTI_URL is set, but mail is not.",
    );
  });

  it("is off, and says why, when USHABTI_URL is not a web address", () => {
    const config = forgotConfig({ ...MAIL, USHABTI_URL: "tasks.example.com" });
    expect(!config.on && config.why).toBe(
      "Forgot password is off: USHABTI_URL has to start with http:// or https://.",
    );
  });

  it("is on with both, and keeps the address without a slash at the end", () => {
    expect(forgotConfig({ ...MAIL, USHABTI_URL: "https://tasks.example.com/" })).toEqual({
      on: true,
      origin: "https://tasks.example.com",
    });
  });
});

describe("forgotLink", () => {
  it("is the reset page under the public address", () => {
    expect(forgotLink("https://tasks.example.com", "ushr_abc")).toBe(
      "https://tasks.example.com/reset/ushr_abc",
    );
  });
});

describe("forgotMail", () => {
  it("carries the link once, the 24 hours, and says to do nothing if you did not ask", () => {
    const mail = forgotMail({
      to: "bo@example.com",
      name: "Bo Member",
      link: "https://tasks.example.com/reset/ushr_abc",
      hours: 24,
    });
    expect(mail.to).toBe("bo@example.com");
    expect(mail.text.split("https://tasks.example.com/reset/ushr_abc")).toHaveLength(2);
    expect(mail.text).toContain("It works once, for 24 hours.");
    expect(mail.text).toContain("If you did not ask for this, do nothing.");
    // Nobody made this one for them, so it names nobody.
    expect(mail.text).not.toMatch(/made a link/);
  });
});

describe("deadLinkSaid", () => {
  it("points at the owner while the flow is off, and at Forgot password? while it is on", () => {
    expect(deadLinkSaid(false)).toBe(LINK_IS_DEAD);
    expect(deadLinkSaid(true)).toContain("Forgot password?");
    expect(deadLinkSaid(true)).not.toContain("owner");
  });
});
