import { createTransport } from "nodemailer";

/**
 * Mail, and the only place in Ushabti that knows it goes over SMTP.
 *
 * It is set by the environment, like the database: `SMTP_URL` says where to
 * send and `MAIL_FROM` says who it is from. Both, or it stays off, and off is
 * the board as it was before there was any mail. Every provider speaks SMTP,
 * so one URL covers them all; an adapter for somebody's HTTP API would slot
 * in behind `sendMail()` and nothing that calls it would change.
 *
 * Nothing here queues and nothing retries. A route sends after its write is
 * committed, waits a short while and tells the person what happened, and the
 * link stays on the screen either way, because an email can still be lost.
 */

/** How long a send may take, from the first byte to the last answer. */
export const MAIL_TIMEOUT_MS = 10_000;

export type MailConfig =
  | { on: true; url: string; from: string }
  /** `why` is the sentence the server logs once at start; null when nothing was asked for. */
  | { on: false; why: string | null };

type Env = Record<string, string | undefined>;

/** What the environment asks for. Read afresh, so a test drives every answer. */
export function mailConfig(env: Env = process.env): MailConfig {
  const url = env.SMTP_URL?.trim() ?? "";
  const from = env.MAIL_FROM?.trim() ?? "";
  if (!url && !from) return { on: false, why: null };
  if (!url) return { on: false, why: "Mail is off: MAIL_FROM is set, but SMTP_URL is not." };
  if (!from) return { on: false, why: "Mail is off: SMTP_URL is set, but MAIL_FROM is not." };
  if (!/^smtps?:\/\//i.test(url)) {
    return { on: false, why: "Mail is off: SMTP_URL has to start with smtp:// or smtps://." };
  }
  return { on: true, url, from };
}

/**
 * Whether a send must upgrade with STARTTLS before it logs in. Without this,
 * an smtp:// server that offers no STARTTLS, or a network that strips it,
 * gets the password and the reset link in clear text. A relay on this same
 * machine is the one place plain SMTP never crosses a wire.
 */
export function needsTls(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol.toLowerCase() !== "smtp:") return false;
  const host = parsed.hostname.toLowerCase();
  return !(host === "localhost" || host === "[::1]" || /^127\./.test(host));
}

export function mailIsOn(env: Env = process.env): boolean {
  return mailConfig(env).on;
}

export type Mail = { to: string; subject: string; text: string };

/**
 * Sends one plain-text email and answers whether the server took it. It
 * never throws: a send that fails must never reach the write before it.
 * Off, it answers false without a word, which is what a route tells the
 * person as well.
 */
export async function sendMail(
  mail: Mail,
  env: Env = process.env,
  timeoutMs = MAIL_TIMEOUT_MS,
): Promise<boolean> {
  const config = mailConfig(env);
  if (!config.on) return false;

  let transport: ReturnType<typeof createTransport> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    transport = createTransport({
      url: config.url,
      requireTLS: needsTls(config.url),
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
    // The three timeouts above are each per step; this one is the whole send.
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error("The mail server took too long.")), timeoutMs);
    });
    await Promise.race([
      transport.sendMail({
        from: config.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      }),
      late,
    ]);
    return true;
  } catch (err) {
    // The address is in the log, and the reason; the body is not, because it carries a link.
    console.error(`Could not email ${mail.to}: ${err instanceof Error ? err.message : err}`);
    return false;
  } finally {
    clearTimeout(timer);
    transport?.close();
  }
}

/** The invite, to an email with no account yet. */
export function inviteMail(input: {
  to: string;
  inviter: string;
  project: string;
  origin: string;
}): Mail {
  return {
    to: input.to,
    subject: `${input.inviter} invited you to ${input.project} on Ushabti`,
    text: [
      `${input.inviter} invited you to the project ${input.project} on Ushabti.`,
      "",
      "Sign up here with this same email address, and you are in the project at once:",
      "",
      `${input.origin}/register`,
      "",
      `The invite is for ${input.to}. An account with another address does not join.`,
    ].join("\n"),
  };
}

/** A reset link, to the member it was made for. */
export function resetMail(input: {
  to: string;
  name: string;
  maker: string;
  project: string;
  link: string;
  hours: number;
}): Mail {
  return {
    to: input.to,
    subject: "A link to set a new Ushabti password",
    text: [
      `Hello ${input.name},`,
      "",
      `${input.maker} made a link for you in ${input.project} to set a new password for your Ushabti account.`,
      "",
      input.link,
      "",
      `It works once, for ${input.hours} hours. Using it signs you out everywhere.`,
      "If you did not ask for it, you can ignore this email.",
    ].join("\n"),
  };
}

/**
 * A reset link the person asked for on the sign-in page. Its own words,
 * because nobody made this link for them: anybody can type an email there.
 */
export function forgotMail(input: { to: string; name: string; link: string; hours: number }): Mail {
  return {
    to: input.to,
    subject: "A link to set a new Ushabti password",
    text: [
      `Hello ${input.name},`,
      "",
      "Somebody asked for a link to set a new password for your Ushabti account.",
      "",
      input.link,
      "",
      `It works once, for ${input.hours} hours. Using it signs you out everywhere.`,
      "If you did not ask for this, do nothing. Your password stays as it is.",
    ].join("\n"),
  };
}
