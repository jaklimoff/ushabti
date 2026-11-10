import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isPrivateIp, privateSentence } from "./webhook-address";

/**
 * One POST to a receiver, through the address that was checked.
 *
 * Checking a name and then handing the URL to `fetch` resolves it twice, and
 * a name can answer a public address the first time and a private one the
 * second. So the check sits in the socket's own `lookup`: the one answer that
 * is checked is the one answer the socket connects to.
 *
 * Nothing follows a redirect. A 3xx is the receiver's answer, written on the
 * row like any other code, so a redirect cannot reach inside either.
 */

/** A refusal, with the sentence the delivery row shows. */
export class PrivateAddressError extends Error {
  readonly code = "EPRIVATE";
  constructor(sentence: string) {
    super(sentence);
    this.name = "PrivateAddressError";
  }
}

/** How a name becomes addresses. The real resolver, unless a test hands one. */
export type Resolve = (host: string) => Promise<LookupAddress[]>;

const systemResolve: Resolve = (host) =>
  new Promise((done, fail) =>
    dnsLookup(host, { all: true }, (err, addresses) => (err ? fail(err) : done(addresses))),
  );

/**
 * A socket `lookup` that resolves once and refuses the lot when any answer is
 * private. Refusing on one bad answer rather than skipping it keeps a name
 * from offering a private address to a happy-eyeballs race.
 */
export function guardedLookup(
  allowPrivate: boolean,
  resolve: Resolve = systemResolve,
  isPrivate: (ip: string) => boolean = isPrivateIp,
): LookupFunction {
  return (host, options, callback) => {
    resolve(host).then(
      (all) => {
        const wanted = options.family ? all.filter((a) => a.family === options.family) : all;
        const inside = allowPrivate ? undefined : wanted.find((a) => isPrivate(a.address));
        if (inside) {
          callback(new PrivateAddressError(privateSentence(`${host} (${inside.address})`)), "", 4);
        } else if (wanted.length === 0) {
          const err = Object.assign(new Error(`no address for ${host}`), { code: "ENOTFOUND" });
          callback(err, "", 4);
        } else if (options.all) {
          (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, wanted);
        } else {
          callback(null, wanted[0].address, wanted[0].family);
        }
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 4),
    );
  };
}

export type PostOptions = {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  allowPrivate: boolean;
  resolve?: Resolve;
  isPrivate?: (ip: string) => boolean;
};

/**
 * The status the receiver answered. It throws a `PrivateAddressError` when the
 * name answers a private address, an error named `TimeoutError` when nothing
 * answers in time, and the socket's own error for the rest.
 */
export function postWebhook(url: string, options: PostOptions): Promise<number> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? https.request : http.request;
  const signal = AbortSignal.timeout(options.timeoutMs);

  return new Promise((done, fail) => {
    const req = send(
      target,
      {
        method: "POST",
        headers: { ...options.headers, "content-length": Buffer.byteLength(options.body) },
        lookup: guardedLookup(options.allowPrivate, options.resolve, options.isPrivate),
        agent: false,
        signal,
      },
      (res) => {
        // The body is not read; draining it lets the socket close.
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.on("error", (err) => {
      if (signal.aborted) {
        const timeout = new Error(`no answer in ${options.timeoutMs} ms`);
        timeout.name = "TimeoutError";
        fail(timeout);
      } else {
        fail(err);
      }
    });
    req.end(options.body);
  });
}
