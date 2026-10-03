/**
 * The value of a Link property: a list of web addresses, such as the pull
 * requests that carry a task's code.
 *
 * Nothing here fetches a link or names a host. How a link reads comes from the
 * shape of its path alone, so a GitLab merge request reads the way a GitHub
 * pull request does. The server and the browser both read this file, so a
 * link reads the same on a card, in a list and in the panel.
 */

/** The most links one value holds. */
export const MAX_LINKS = 20;

/** The longest one link may be. */
export const MAX_LINK_LENGTH = 2000;

/** Why a list of links was refused, in words a person can act on. */
export class LinkError extends Error {}

/** The URL of a link, or null when it is not an http or https address. */
function parse(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * What two links are compared by. The fragment and a trailing `/` say nothing
 * about which page it is, so a pull request pasted with `#issuecomment-1` or
 * with a slash on the end is the same pull request.
 */
export function linkKey(raw: string): string {
  const url = parse(raw.trim());
  if (!url) return raw.trim();
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** True when this is a link the server will keep. */
export function isLink(raw: string): boolean {
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_LINK_LENGTH && parse(text) !== null;
}

/**
 * A raw value, as the list of links to store. Each link is kept as it was
 * given, and the first of two that compare the same wins. It throws a
 * `LinkError` rather than drop a link in silence: a link that vanished on the
 * way in reads as saved.
 */
export function readLinks(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  const list = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(list)) throw new LinkError("needs a list of links.");

  const links: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") throw new LinkError("needs a list of links.");
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_LINK_LENGTH) {
      throw new LinkError(`takes links of at most ${MAX_LINK_LENGTH} characters.`);
    }
    if (!parse(text)) throw new LinkError("takes only http and https links.");
    const key = linkKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(text);
  }
  if (links.length > MAX_LINKS) throw new LinkError(`holds at most ${MAX_LINKS} links.`);
  return links;
}

/** The links a stored value holds. Anything else holds none. */
export function linksOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The path ends of a pull request, an issue or a merge request. */
const NUMBERED = /^(.*)\/(?:pull|pulls|issues|merge_requests)\/(\d+)$/;

/** How long the words of a link may grow before they are made shorter. */
const SHORT = 48;

/**
 * How a link reads. A path that ends in `/pull/N`, `/pulls/N`, `/issues/N` or
 * `/merge_requests/N` reads as `owner/repo#N`: the two parts of the path in
 * front of it, with GitLab's `-` step left out. Any other link reads as its
 * host and path, made shorter.
 */
export function linkLabel(raw: string): string {
  const url = parse(raw.trim());
  if (!url) return shorten(raw.trim());
  const path = url.pathname.replace(/\/+$/, "");

  const numbered = NUMBERED.exec(path);
  if (numbered) {
    const parts = numbered[1].split("/").filter((p) => p && p !== "-");
    if (parts.length >= 2) {
      return `${decode(parts[parts.length - 2])}/${decode(parts[parts.length - 1])}#${numbered[2]}`;
    }
  }

  const host = url.host.replace(/^www\./, "");
  return shorten(decode(`${host}${path}`));
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function shorten(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT - 1)}…` : text;
}
