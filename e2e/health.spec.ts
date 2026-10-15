import { expect, test } from "@playwright/test";

/* A monitor calls it with nothing: a fresh context has no cookie and sends
   no token. The answer must say "up" and nothing about the board. */
test("the health route answers a caller with no session or token", async ({ playwright }) => {
  const url = test.info().project.use.baseURL;
  const anon = await playwright.request.newContext({ baseURL: url, storageState: undefined });
  const res = await anon.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(await res.json()).toEqual({ ok: true });
  await anon.dispose();
});
