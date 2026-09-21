/**
 * Which addresses a webhook may be pointed at.
 *
 * A webhook is the one place where a person tells the server to make a
 * request for them. Left open, the settings page becomes a port scanner with
 * a readable answer: a URL of `http://169.254.169.254/latest/meta-data/` or
 * `http://127.0.0.1:5432/` comes back on the row as a code and a reason, and
 * the owner learns what is inside the network Ushabti runs in.
 *
 * So the host has to be somewhere a stranger could also reach. A self-hoster
 * whose receiver really is on the same private network says so once, in the
 * environment, and then it is their decision rather than an accident.
 *
 * Nothing here reads the database, the network or the environment — the flag
 * is an argument — so a unit test drives the whole rule.
 */

/** Set it to `1` and a private, loopback or link-local host is allowed. */
export const PRIVATE_FLAG = "USHABTI_WEBHOOK_PRIVATE";

export function privateAddressesAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[PRIVATE_FLAG] === "1";
}

/** Names that always mean this machine, whatever the resolver says. */
const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

/* ------------------------------------------------------------------ */
/* Literal addresses                                                   */
/* ------------------------------------------------------------------ */

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  return numbers.every((n) => n >= 0 && n <= 255) ? numbers : null;
}

/**
 * The IPv6 groups, or null. It expands `::` and reads a trailing IPv4 part,
 * which is how an IPv4 address arrives dressed as an IPv6 one.
 */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  if (!text.includes(":")) return null;

  /* `::ffff:127.0.0.1` is 127.0.0.1 wearing another coat. The four numbers
     become the last two groups, and the rest reads as usual. */
  const dotted = text.lastIndexOf(".") > text.lastIndexOf(":") ? text.split(":").pop()! : null;
  if (dotted !== null) {
    const v4 = ipv4Parts(dotted);
    if (!v4) return null;
    const high = (v4[0] << 8) | v4[1];
    const low = (v4[2] << 8) | v4[3];
    text = text.slice(0, text.length - dotted.length) + `${hex(high)}:${hex(low)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1));

  const head = read(halves[0]);
  const tail = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...tail].some((g) => g < 0)) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail];
}

function hex(n: number): string {
  return n.toString(16);
}

/** Whether a literal address is one only somebody already inside can reach. */
export function isPrivateIp(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];

  const v4 = ipv4Parts(bare);
  if (v4) return privateV4(v4);

  const v6 = ipv6Groups(bare);
  if (!v6) return false;

  /* `::1`, `::` and `::ffff:127.0.0.1` are all an IPv4 address in an IPv6
     coat: the first five groups are zero and what is left is the address. So
     one rule answers loopback, "this host" and a mapped private range alike,
     and `::ffff:8.8.8.8` is still public. */
  if (v6.slice(0, 5).every((g) => g === 0) && (v6[5] === 0 || v6[5] === 0xffff)) {
    return privateV4([v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff]);
  }
  // fe80::/10 link-local, and fc00::/7 unique local.
  if ((v6[0] & 0xffc0) === 0xfe80) return true;
  if ((v6[0] & 0xfe00) === 0xfc00) return true;
  return false;
}

function privateV4([a, b]: number[]): boolean {
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8 — "this host", which is loopback by another road
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  return false;
}

/** Whether a host — a name or a literal — is one a stranger could not reach. */
export function isPrivateHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOCAL_NAMES.has(bare) || bare.endsWith(".localhost")) return true;
  return isPrivateIp(bare);
}

/* ------------------------------------------------------------------ */
/* The answer a person reads                                           */
/* ------------------------------------------------------------------ */

/** The sentence a private host is refused with. One place says it. */
export function privateSentence(host: string): string {
  return `${host} is a private address, and Ushabti will not call one: a webhook must not be a way to reach inside the network the board runs in. Set ${PRIVATE_FLAG}=1 on the server if the receiver really is in there.`;
}

/**
 * Why this URL is refused, or null when it is fine.
 *
 * It answers on the text alone. A name that resolves to a private address is
 * the harder case and is asked again in the sender, where there is a resolver.
 */
export function refuseAddress(raw: string, allowPrivate: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That does not look like a URL.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "A webhook URL starts with http:// or https://.";
  }

  /* A name and password in the URL are sent to whoever answers, and they hide
     the real host from a reader: `http://example.com@169.254.169.254/` is not
     a call to example.com. The secret Ushabti sends is the signature. */
  if (url.username || url.password) {
    return "A webhook URL cannot carry a name and a password. Every delivery is signed instead, and your receiver checks the signature.";
  }

  if (!allowPrivate && isPrivateHost(url.hostname)) return privateSentence(url.hostname);
  return null;
}
