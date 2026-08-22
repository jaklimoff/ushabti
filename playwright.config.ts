import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  // Locally the dev server is already up in Docker, so this reuses it.
  // On CI there is nothing running yet, so Playwright starts one itself.
  webServer: {
    command: "npm run dev",
    url: process.env.BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
