import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// `npm run start` is the standalone server, and it reads `PORT`. So the tests
// read it too: a machine where 3000 is taken can still run the CI way.
const port = process.env.PORT ?? "3000";
const baseURL = process.env.CI ? `http://localhost:${port}` : "http://localhost:3050";
// `||`, not `??`: an empty BASE_URL= means "the default", not an invalid URL.
const url = process.env.BASE_URL || baseURL;

// A production build sets the session cookie `Secure`. The browser sends it to
// a bare IP over http anyway, but Playwright's request context does not, so
// every spec that reads the API through `page.request` answers 401 and blames
// the count it was checking. Refuse the host here, where the cause fits in a
// sentence, rather than let eighteen specs fail for a reason none of them name.
const host = new URL(url).hostname;
if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) {
  throw new Error(
    `Use localhost in BASE_URL, not ${host}: the session cookie is Secure, and page.request will not send a Secure cookie to a bare IP.`,
  );
}

// Mail is set by the environment of the server, so a test cannot switch it on
// for itself. When Playwright starts the server, it points the server at a
// free port of this machine, where `e2e/mail.spec.ts` listens with a small
// SMTP receiver of its own. The port is chosen once, here, and handed to the
// workers through the environment they inherit. A server that is reused — the
// dev server in Docker — has no mail, and the spec checks that instead.
if (process.env.CI && !process.env.USHABTI_TEST_SMTP_PORT) {
  process.env.USHABTI_TEST_SMTP_PORT = execFileSync(process.execPath, [
    "-e",
    "const s = require('net').createServer().listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); });",
  ]).toString();
}
const smtpPort = process.env.USHABTI_TEST_SMTP_PORT;

// The one SMTP port is one listener at a time, so the specs that open it run
// in a project of their own, one file after another. Everything else shares
// nothing but the database, where each test makes its own user and project.
const serial = /\/(mail|forgot|reset|ask-mail)\.spec\.ts$/;

// "Desktop Chrome" carries a viewport of its own (1280x720) and would quietly
// replace the size set under `use`, so it goes back on after. Board bugs that
// only show on a tall window were invisible while it did.
const chrome = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "./e2e",
  // A file runs in order, on one worker; four files run at once. No file may
  // count on running after another.
  fullyParallel: false,
  workers: 4,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  // Locally the dev server is already up in Docker on 3050, so this reuses it.
  // On CI there is nothing running yet, so Playwright starts one itself with
  // `npm run start`, which is `.next/standalone/server.js` — the very server
  // the image runs. `next dev` used to serve CI, which meant the tests never
  // touched what the image ships, and every route paid for its first compile
  // inside a test. CI already runs `npm run build`, so `start` costs nothing
  // more and each page is ready when it is asked for. The port follows the
  // server and not the machine, which is why it is read from `PORT`.
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    // The webhook specs start a receiver of their own on a free port of this
    // machine, which is a loopback address and refused by default. A test
    // server is allowed to call one; nothing else in the suite reads this.
    env: {
      USHABTI_WEBHOOK_PRIVATE: "1",
      ...(smtpPort
        ? {
            SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
            MAIL_FROM: "Ushabti <board@example.com>",
            // "Forgot password?" builds its link from this, never from the request.
            USHABTI_URL: url,
          }
        : {}),
    },
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: url,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "chromium", use: chrome, testIgnore: serial },
    { name: "mail", use: chrome, testMatch: serial, workers: 1 },
  ],
});
