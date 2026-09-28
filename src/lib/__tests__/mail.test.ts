import { afterEach, describe, expect, it, vi } from "vitest";
import { smtpReceiver, type SmtpReceiver } from "../../../e2e/smtp";
import { inviteMail, mailConfig, mailIsOn, resetMail, sendMail } from "@/lib/mail";

/**
 * Mail is the environment's to switch on, and a send never throws.
 *
 * The sends go to a real socket — the same small receiver the end-to-end test
 * uses — because what is under test is what reaches a mail server, and a
 * stubbed transport would only say what nodemailer was asked.
 */
describe("mailConfig", () => {
  it("is off and silent with neither variable, as the board was before mail", () => {
    expect(mailConfig({})).toEqual({ on: false, why: null });
    expect(mailConfig({ SMTP_URL: " ", MAIL_FROM: "" })).toEqual({ on: false, why: null });
    expect(mailIsOn({})).toBe(false);
  });

  it("stays off and says why when SMTP_URL has no MAIL_FROM", () => {
    const config = mailConfig({ SMTP_URL: "smtps://user:pass@mail.example.com:465" });
    expect(config.on).toBe(false);
    expect(!config.on && config.why).toBe("Mail is off: SMTP_URL is set, but MAIL_FROM is not.");
  });

  it("stays off and says why for half a setting or a URL that is not SMTP", () => {
    expect(mailConfig({ MAIL_FROM: "a@b.c" })).toMatchObject({ on: false, why: /SMTP_URL/ });
    expect(mailConfig({ SMTP_URL: "https://mail.example.com", MAIL_FROM: "a@b.c" })).toMatchObject({
      on: false,
      why: /smtp:\/\/ or smtps:\/\//,
    });
  });

  it("is on with both", () => {
    const env = { SMTP_URL: "smtp://127.0.0.1:2525", MAIL_FROM: "Ushabti <board@example.com>" };
    expect(mailConfig(env)).toEqual({
      on: true,
      url: "smtp://127.0.0.1:2525",
      from: "Ushabti <board@example.com>",
    });
    expect(mailIsOn(env)).toBe(true);
  });
});

describe("sendMail", () => {
  let receiver: SmtpReceiver | null = null;
  afterEach(async () => {
    await receiver?.stop();
    receiver = null;
    vi.restoreAllMocks();
  });

  const letter = { to: "new@example.com", subject: "Hello", text: "One line.\nTwo lines." };

  it("hands the letter to the SMTP server and answers true", async () => {
    receiver = await smtpReceiver();
    const env = { SMTP_URL: `smtp://127.0.0.1:${receiver.port}`, MAIL_FROM: "board@example.com" };

    expect(await sendMail(letter, env)).toBe(true);
    const got = await receiver.next(2_000);
    expect(got.from).toBe("board@example.com");
    expect(got.to).toEqual(["new@example.com"]);
    expect(got.raw).toMatch(/^Subject: Hello$/m);
    expect(got.raw).toMatch(/^Content-Type: text\/plain/m);
    expect(got.text).toContain("One line.");
  });

  it("answers false without a word when mail is off, and sends nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendMail(letter, {})).toBe(false);
    expect(await sendMail(letter, { SMTP_URL: "smtp://127.0.0.1:1" })).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });

  it("answers false, and does not throw, when nothing listens", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const shut = await smtpReceiver();
    const port = shut.port;
    await shut.stop();
    const env = { SMTP_URL: `smtp://127.0.0.1:${port}`, MAIL_FROM: "board@example.com" };
    expect(await sendMail(letter, env)).toBe(false);
  });

  it("gives up on a server that never answers, at the time limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    receiver = await smtpReceiver(0, { silent: true });
    const env = { SMTP_URL: `smtp://127.0.0.1:${receiver.port}`, MAIL_FROM: "board@example.com" };
    const started = Date.now();
    expect(await sendMail(letter, env, 300)).toBe(false);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(3_000);
  });
});

describe("the letters", () => {
  it("an invite names who, where, the sign-up link, and the same email", () => {
    const mail = inviteMail({
      to: "new@example.com",
      inviter: "Ada Owner",
      project: "Launch",
      origin: "https://board.example.com",
    });
    expect(mail.to).toBe("new@example.com");
    expect(mail.subject).toBe("Ada Owner invited you to Launch on Ushabti");
    expect(mail.text).toContain("Ada Owner invited you to the project Launch");
    expect(mail.text).toContain("\nhttps://board.example.com/register\n");
    expect(mail.text).toContain("with this same email address");
    expect(mail.text).toContain("new@example.com");
  });

  it("a reset link carries the link, that it works once, for 24 hours", () => {
    const mail = resetMail({
      to: "member@example.com",
      name: "Bo Member",
      maker: "Ada Owner",
      project: "Launch",
      link: "https://board.example.com/reset/ushr_abc",
      hours: 24,
    });
    expect(mail.to).toBe("member@example.com");
    expect(mail.text).toContain("\nhttps://board.example.com/reset/ushr_abc\n");
    expect(mail.text).toContain("It works once, for 24 hours.");
  });
});
