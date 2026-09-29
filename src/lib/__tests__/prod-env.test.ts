import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { poolMax } from "@/db/url";
import { signupIsOpen } from "../signup";
import { privateAddressesAllowed } from "../webhook-address";

/**
 * Compose reads `.env` only to fill a `${…}` in the file, so a setting the
 * file does not name never reaches the server. Each one is passed empty when
 * unset, which is why an empty value has to read exactly as a missing one.
 */
const SETTINGS = ["USHABTI_SIGNUP", "USHABTI_WEBHOOK_PRIVATE", "DATABASE_POOL_MAX"];

function appEnvironment(): string {
  const file = readFileSync(new URL("../../../docker-compose.prod.yml", import.meta.url), "utf8");
  const app = file.slice(file.indexOf("\n  app:"));
  return app.slice(app.indexOf("environment:"), app.indexOf("ports:"));
}

describe("docker-compose.prod.yml", () => {
  it.each(SETTINGS)("passes %s from .env to the app, empty when unset", (name) => {
    expect(appEnvironment()).toContain(`${name}: \${${name}:-}`);
  });
});

describe("an empty setting reads as an unset one", () => {
  it("keeps sign-up open", () => {
    expect(signupIsOpen({ USHABTI_SIGNUP: "" })).toBe(true);
    expect(signupIsOpen({})).toBe(true);
    expect(signupIsOpen({ USHABTI_SIGNUP: "closed" })).toBe(false);
    expect(signupIsOpen({ USHABTI_SIGNUP: "Closed" })).toBe(false);
  });

  it("keeps a private webhook refused", () => {
    expect(privateAddressesAllowed({ USHABTI_WEBHOOK_PRIVATE: "" })).toBe(false);
    expect(privateAddressesAllowed({})).toBe(false);
    expect(privateAddressesAllowed({ USHABTI_WEBHOOK_PRIVATE: "1" })).toBe(true);
  });

  it("keeps the pool at 12", () => {
    expect(poolMax({ DATABASE_POOL_MAX: "" })).toBe(12);
    expect(poolMax({})).toBe(12);
    expect(poolMax({ DATABASE_POOL_MAX: "5" })).toBe(5);
    expect(poolMax({ DATABASE_POOL_MAX: "0" })).toBe(12);
  });
});
