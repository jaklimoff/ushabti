import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { commands } from "./src/test/commands";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": src("") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
          /* The two projects take turns, because each has its own number of
             workers. */
          sequence: { groupOrder: 0 },
        },
      },
      /* A component is drawn in the Chromium Playwright already installed:
         real layout, real CSS modules, real keys. Other projects' agents share
         this machine, so it opens four pages at most. */
      {
        extends: true,
        resolve: {
          /* Next's router is mounted by the app, never by a test. These two
             stand in for it, and nothing else of Next reaches a component. */
          alias: {
            "next/navigation": src("test/next-navigation.ts"),
            "next/link": src("test/next-link.tsx"),
          },
        },
        oxc: { jsx: { runtime: "automatic" } },
        define: { "process.env.NODE_ENV": JSON.stringify("test") },
        test: {
          name: "browser",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup.ts"],
          maxWorkers: 4,
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            headless: true,
            /* The size the end to end suite draws at. Vitest's own is a phone. */
            viewport: { width: 1440, height: 900 },
            /* Words match as Playwright's do, so a test moved down from e2e
               reads the same. */
            locators: { exact: false },
            provider: playwright(),
            commands,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
