/**
 * The one line a screen says after a route tried to email a link.
 *
 * Null while mail is off, so a board with no `SMTP_URL` reads as it did
 * before there was any mail. The link stays on the screen in both other
 * cases, because an email can still be lost.
 */
export function emailedLine(mailOn: boolean, emailed: boolean, email: string): string | null {
  if (!mailOn) return null;
  return emailed ? `Emailed to ${email}.` : `Could not email ${email}. Send them this link.`;
}
