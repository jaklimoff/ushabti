import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

/* A monitor calls it with nothing: a fresh context has no cookie and sends
   no token. The answer must say "up", whether this server hears changes and
   which release it runs, and nothing about the board. */
test("the health route answers a caller with no session or token", async ({ playwright }) => {
  const url = test.info().project.use.baseURL;
  const anon = await playwright.request.newContext({ baseURL: url, storageState: undefined });
  const res = await anon.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body).toEqual({ ok: true, listening: expect.any(Boolean), version });
  await anon.dispose();
});
