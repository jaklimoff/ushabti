/**
 * Runs once as the server starts.
 *
 * Mail set up by halves stays off, and the person who set it has no screen
 * that would tell them, so the server says why here, once, where they will
 * look for it: the log of the process they just started. "Forgot password?"
 * needs mail and a public address, and says so the same way.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { mailConfig } = await import("./lib/mail");
  const config = mailConfig();
  if (!config.on && config.why) console.warn(config.why);
  const { forgotConfig } = await import("./lib/forgot");
  const forgot = forgotConfig();
  if (!forgot.on && forgot.why) console.warn(forgot.why);
}
