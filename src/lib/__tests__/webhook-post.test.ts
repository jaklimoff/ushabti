import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isPrivateIp } from "../webhook-address";
import { PrivateAddressError, postWebhook, type Resolve } from "../webhook-post";

/**
 * The connect itself, against a real socket on this machine.
 *
 * A test cannot own a public address, so in the tests that must reach the
 * receiver, 127.0.0.1 is called public by the `isPrivate` the sender is
 * handed. Everything else is the real rule.
 */
const servers: Server[] = [];

async function receiver(answer: (path: string) => [number, Record<string, string>?]) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    req.resume();
    const [status, headers] = answer(req.url ?? "");
    res.writeHead(status, headers).end();
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { port: (server.address() as AddressInfo).port, hits };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(() => done(null)))));
});

/** A resolver that answers each call in turn, and counts the calls. */
function answers(...ips: string[]): Resolve & { calls: number } {
  const resolve = async () => {
    const ip = ips[Math.min(resolve.calls, ips.length - 1)];
    resolve.calls += 1;
    return [{ address: ip, family: ip.includes(":") ? 6 : 4 }];
  };
  resolve.calls = 0;
  return resolve;
}

/** 127.0.0.1 stands in for a public address; the rest is the real rule. */
const loopbackIsPublic = (ip: string) => ip !== "127.0.0.1" && isPrivateIp(ip);

const send = { headers: {}, body: "{}", timeoutMs: 2_000, allowPrivate: false };

describe("a delivery connects to the address that was checked", () => {
  it("refuses a name whose answer at connect time is private, and never connects", async () => {
    const box = await receiver(() => [200]);
    const resolve = answers("10.0.0.5");

    const tried = postWebhook(`http://hooks.example.test:${box.port}/`, { ...send, resolve });

    await expect(tried).rejects.toBeInstanceOf(PrivateAddressError);
    await expect(tried).rejects.toThrow(/hooks\.example\.test \(10\.0\.0\.5\)/);
    expect(box.hits).toEqual([]);
  });

  it("asks the name once, so a second answer that turns private is never the one used", async () => {
    const box = await receiver(() => [204]);
    // Public on the first ask, private on every ask after it.
    const resolve = answers("127.0.0.1", "10.0.0.5");

    const status = await postWebhook(`http://rebind.example.test:${box.port}/`, {
      ...send,
      resolve,
      isPrivate: loopbackIsPublic,
    });

    expect(status).toBe(204);
    expect(resolve.calls).toBe(1);
    expect(box.hits).toEqual(["/"]);
  });

  it("refuses a name that answered public to an earlier check and private at the connect", async () => {
    /* The old sender checked with one ask and connected with a second. Make
       that first ask here, as the check would have: it answers public. The
       ask the socket makes answers private, and that is the one refused. */
    const box = await receiver(() => [200]);
    const resolve = answers("127.0.0.1", "10.0.0.5");
    const checked = await resolve("rebind.example.test");
    expect(loopbackIsPublic(checked[0].address)).toBe(false);

    await expect(
      postWebhook(`http://rebind.example.test:${box.port}/`, {
        ...send,
        resolve,
        isPrivate: loopbackIsPublic,
      }),
    ).rejects.toThrow(/rebind\.example\.test \(10\.0\.0\.5\)/);
    expect(resolve.calls).toBe(2);
    expect(box.hits).toEqual([]);
  });

  it("refuses the lot when any one answer is private", async () => {
    const box = await receiver(() => [200]);
    const resolve: Resolve = async () => [
      { address: "127.0.0.1", family: 4 },
      { address: "64:ff9b::a9fe:a9fe", family: 6 },
    ];

    await expect(
      postWebhook(`http://both.example.test:${box.port}/`, {
        ...send,
        resolve,
        isPrivate: loopbackIsPublic,
      }),
    ).rejects.toBeInstanceOf(PrivateAddressError);
    expect(box.hits).toEqual([]);
  });

  it("lets a private answer through when the server allows private receivers", async () => {
    const box = await receiver(() => [200]);
    const status = await postWebhook(`http://inside.example.test:${box.port}/`, {
      ...send,
      allowPrivate: true,
      resolve: answers("127.0.0.1"),
    });
    expect(status).toBe(200);
  });
});

describe("a redirect", () => {
  it("is not followed: the 3xx is the answer, and the private target is never called", async () => {
    const inside = await receiver(() => [200]);
    const front = await receiver(() => [
      302,
      { location: `http://127.0.0.1:${inside.port}/latest/meta-data/` },
    ]);

    const status = await postWebhook(`http://front.example.test:${front.port}/`, {
      ...send,
      resolve: answers("127.0.0.1"),
      isPrivate: loopbackIsPublic,
    });

    expect(status).toBe(302);
    expect(front.hits).toEqual(["/"]);
    expect(inside.hits).toEqual([]);
  });
});

describe("a receiver that never answers", () => {
  it("gives up with a TimeoutError", async () => {
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;

    await expect(
      postWebhook(`http://slow.example.test:${port}/`, {
        ...send,
        timeoutMs: 100,
        allowPrivate: true,
        resolve: answers("127.0.0.1"),
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    server.closeAllConnections();
  });
});
