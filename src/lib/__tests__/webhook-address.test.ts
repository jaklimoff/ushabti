import { describe, expect, it } from "vitest";
import {
  isPrivateHost,
  isPrivateIp,
  PRIVATE_FLAG,
  privateAddressesAllowed,
  refuseAddress,
} from "../webhook-address";

/**
 * The seven a reviewer pointed a webhook at, each of which answered with a
 * code and a reason and turned the settings page into a port scanner. They
 * are written out rather than generated: this is the list the rule exists
 * for, and a change that lets one of them back through has to say so here.
 */
const INSIDE = [
  "http://169.254.169.254/latest/meta-data/",
  "http://127.0.0.1:5435/",
  "http://localhost:3115/api/projects",
  "http://10.0.0.5/",
  "http://[::1]:9999/",
  "http://user:pass@169.254.169.254/",
  "http://192.168.1.8:3105/api/projects",
];

const OUTSIDE = [
  "https://example.com/ushabti",
  "http://hooks.slack.test:8080/services/abc",
  "https://8.8.8.8/ring",
];

describe("an address a webhook may be pointed at", () => {
  it("refuses every one of these, and says why in a sentence", () => {
    for (const url of INSIDE) {
      const said = refuseAddress(url, false);
      expect(said, url).not.toBeNull();
      expect(said!.length, url).toBeGreaterThan(20);
    }
  });

  it("allows an address a stranger could reach too", () => {
    for (const url of OUTSIDE) expect(refuseAddress(url, false), url).toBeNull();
  });

  it("refuses a name and password whoever the host is", () => {
    // The credentials go to whoever answers, and they hide the real host: this
    // is a call to 169.254.169.254, not to example.com.
    expect(refuseAddress("https://example.com@169.254.169.254/", false)).not.toBeNull();
    expect(refuseAddress("https://user:pass@example.com/hook", false)).toMatch(
      /name and a password/,
    );
  });

  it("refuses anything that is not http or https", () => {
    expect(refuseAddress("file:///etc/passwd", false)).toMatch(/http/);
    expect(refuseAddress("ftp://example.com/", false)).toMatch(/http/);
    expect(refuseAddress("not a url at all", false)).toMatch(/does not look like/);
  });

  /* A self-hoster whose receiver really is on the same private network says
     so once, on the server. It is then their decision and not an accident. */
  it("lets a private address through only when the flag is set", () => {
    expect(refuseAddress("http://10.0.0.5/", true)).toBeNull();
    expect(refuseAddress("http://127.0.0.1:5435/", true)).toBeNull();
    // The flag never excuses the two that are wrong whatever the network is.
    expect(refuseAddress("http://user:pass@10.0.0.5/", true)).not.toBeNull();
    expect(refuseAddress("ftp://10.0.0.5/", true)).not.toBeNull();
  });

  it("reads the flag off the environment, and only the word 1", () => {
    expect(privateAddressesAllowed({})).toBe(false);
    expect(privateAddressesAllowed({ [PRIVATE_FLAG]: "" })).toBe(false);
    expect(privateAddressesAllowed({ [PRIVATE_FLAG]: "true" })).toBe(false);
    expect(privateAddressesAllowed({ [PRIVATE_FLAG]: "1" })).toBe(true);
  });
});

describe("which literal addresses are inside", () => {
  it("knows the four private ranges, loopback and link-local", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.8",
      "169.254.169.254",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("knows ::1, fe80::/10 and fc00::/7, brackets and zone and all", () => {
    for (const ip of ["::1", "[::1]", "::", "fe80::1", "fe80::1%en0", "fd00::abcd", "fc00::1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("sees through an IPv4 address dressed as an IPv6 one", () => {
    // `::ffff:127.0.0.1` reaches loopback exactly as `127.0.0.1` does.
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("leaves a public address alone, and the neighbours of each range", () => {
    for (const ip of [
      "8.8.8.8",
      "172.15.0.1",
      "172.32.0.1",
      "192.167.1.1",
      "169.253.0.1",
      "1.1.1.1",
      "2606:4700::1111",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("is not fooled by something that only looks like an address", () => {
    expect(isPrivateIp("10.0.0.5.example.com")).toBe(false);
    expect(isPrivateIp("999.0.0.1")).toBe(false);
    expect(isPrivateIp("example.com")).toBe(false);
  });

  it("calls localhost by every name it answers to", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("LOCALHOST")).toBe(true);
    expect(isPrivateHost("api.localhost")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

/**
 * The URL parser normalises the old ways of writing an IPv4 address, so a
 * host that arrives as one decimal number is a dotted quad by the time the
 * rule reads it. Written down because it is the reason the rule can read
 * `hostname` and stop there.
 */
describe("the shorthand forms of an address", () => {
  it("are normalised before the rule sees them", () => {
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(refuseAddress("http://2130706433/", false)).not.toBeNull();
    expect(refuseAddress("http://0177.0.0.1/", false)).not.toBeNull();
    expect(refuseAddress("http://127.1/", false)).not.toBeNull();
  });
});
