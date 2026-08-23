/**
 * Puts text on the clipboard, and says whether it got there.
 *
 * The write fails on an insecure origin and when the browser refuses the
 * permission. Both are silent, so every caller has to be told, and every
 * caller has to leave the person another way to take the text.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
