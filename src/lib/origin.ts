/**
 * The address this board is reached at, as the browser that asked reached it.
 * The person who asked has to send a link to somebody, so it has to be the
 * address their team uses and not the one the container listens on. An
 * emailed link is built from the same answer, so the link in the email and
 * the one on the screen are one link.
 */
export function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.slice(0, -1);
  return `${proto}://${host}`;
}
