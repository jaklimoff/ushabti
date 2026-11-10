import type { Instrumentation } from "next";

/**
 * Runs once as the server starts.
 *
 * Mail set up by halves stays off, and the person who set it has no screen
 * that would tell them, so the server says why here, once, where they will
 * look for it: the log of the process they just started. "Forgot password?"
 * needs mail and a public address, and attachments a bucket and its keys,
 * and both say so the same way.
 *
 * With attachments on, it also makes the bucket, so a fresh store needs no
 * helper to do it. And it ends every open stream when the server is told to
 * stop, or a deploy waits out its whole grace period.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  /* Next closes the server on a stop and waits for every request; the
     streams are ended here so that wait is short. */
  const { onStop } = await import("./lib/shutdown");
  onStop(
    (signal, listener) => process.once(signal, listener),
    (code) => process.exit(code),
  );
  const { mailConfig } = await import("./lib/mail");
  const config = mailConfig();
  if (!config.on && config.why) console.warn(config.why);
  const { forgotConfig } = await import("./lib/forgot");
  const forgot = forgotConfig();
  if (!forgot.on && forgot.why) console.warn(forgot.why);
  const { attachmentConfig } = await import("./lib/attachments");
  const files = attachmentConfig();
  if (!files.on && files.why) console.warn(files.why);
  if (files.on) {
    // Not awaited: the server must not wait a minute for a store to wake.
    const { ensureBucket } = await import("./lib/storage");
    void ensureBucket();
  }
}

/**
 * Every error a request ends in, as one line of JSON. Without it a page
 * that fails leaves only a digest in the browser and nothing here to match
 * it to.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const error = err instanceof Error ? err : new Error(String(err));
  const digest = (err as { digest?: unknown } | null)?.digest;
  console.error(
    JSON.stringify({
      at: "request",
      method: request.method,
      path: request.path,
      route: context.routePath,
      routeType: context.routeType,
      digest: typeof digest === "string" ? digest : undefined,
      error: error.message,
      stack: error.stack,
    }),
  );
};
