import { mailConfig } from "./mail";

/**
 * "Forgot password?" — a reset link the person asks for themselves, by email.
 *
 * It is on only when mail is on and `USHABTI_URL` names the board's public
 * address. The link is built from that setting and never from the request:
 * anybody can send a forged `Host`, and the real person would then get a real
 * email whose link carries a live token to somebody else's site. An admin who
 * makes a link is signed in and reads it on the screen, so that route may
 * trust the headers; this one is open to anybody.
 *
 * Nothing here reads the database or the clock, so a unit test drives it all.
 */

type Env = Record<string, string | undefined>;

export type ForgotConfig =
  | { on: true; origin: string }
  /** `why` is the sentence the server logs once at start; null when nothing was asked for. */
  | { on: false; why: string | null };

/** What the environment asks for. Read afresh, so a test drives every answer. */
export function forgotConfig(env: Env = process.env): ForgotConfig {
  const mail = mailConfig(env).on;
  const url = env.USHABTI_URL?.trim() ?? "";
  if (!mail && !url) return { on: false, why: null };
  if (!mail) {
    return {
      on: false,
      why: "Forgot password is off: USHABTI_URL is set, but mail is not.",
    };
  }
  if (!url) {
    return {
      on: false,
      why: "Forgot password is off: mail is on, but USHABTI_URL is not set, so the server does not know the address to put in the link.",
    };
  }
  const origin = publicOrigin(url);
  if (!origin) {
    return {
      on: false,
      why: "Forgot password is off: USHABTI_URL has to start with http:// or https://.",
    };
  }
  return { on: true, origin };
}

export function forgotIsOn(env: Env = process.env): boolean {
  return forgotConfig(env).on;
}

/** The address with no slash at the end, or null when it is not a web address. */
function publicOrigin(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return url.replace(/\/+$/, "");
}

/** The link a forgot email carries. `origin` is the one `forgotConfig` answered. */
export function forgotLink(origin: string, token: string): string {
  return `${origin}/reset/${token}`;
}
