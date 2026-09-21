import { defineConfig, devices } from "@playwright/test";

// `npm run start` is the standalone server, and it reads `PORT`. So the tests
// read it too: a machine where 3000 is taken can still run the CI way.
const port = process.env.PORT ?? "3000";
const baseURL = process.env.CI ? `http://localhost:${port}` : "http://localhost:3050";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
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
    env: { USHABTI_WEBHOOK_PRIVATE: "1" },
    url: process.env.BASE_URL ?? baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: process.env.BASE_URL ?? baseURL,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  // The viewport comes last: "Desktop Chrome" carries one of its own (1280x720)
  // and would otherwise quietly replace the size set above. Board bugs that
  // only show on a tall window were invisible while it did.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
