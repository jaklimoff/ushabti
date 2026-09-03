// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";

// The site is served from a project page, so every URL carries /ushabti.
// Change `site` and drop `base` if a custom domain is put in front of it.
const site = process.env.SITE_URL ?? "https://jaklimoff.github.io";
const base = process.env.SITE_BASE ?? "/ushabti";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  // The board itself is set in IBM Plex. The docs use the same two faces, and
  // Astro self-hosts them, so the site makes no request off its own origin.
  fonts: [
    {
      provider: fontProviders.google(),
      name: "IBM Plex Sans",
      cssVariable: "--font-ushabti-sans",
      weights: [400, 500, 600, 700],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "IBM Plex Mono",
      cssVariable: "--font-ushabti-mono",
      weights: [400, 500, 600],
      subsets: ["latin"],
      fallbacks: ["ui-monospace", "monospace"],
    },
  ],
  integrations: [
    starlight({
      title: "Ushabti",
      tagline: "A small, fast task board where every field is yours.",
      description:
        "Ushabti is a free, open source task board. Every field on a task is a property you define, and agents work the same board as people.",
      logo: {
        light: "./src/assets/mark-light.svg",
        dark: "./src/assets/mark-dark.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/ushabti.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/jaklimoff/ushabti",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/jaklimoff/ushabti/edit/main/website/",
      },
      lastUpdated: true,
      components: {
        Head: "./src/components/Head.astro",
      },
      credits: false,
      expressiveCode: {
        themes: ["github-dark-default", "github-light"],
        styleOverrides: {
          borderRadius: "8px",
          borderColor: "var(--sl-color-hairline)",
          codeFontSize: "0.8125rem",
          frames: {
            shadowColor: "transparent",
          },
        },
      },
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: site + base + "/og.png" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "What Ushabti is", link: "/start/what-it-is/" },
            { label: "Run it in one command", link: "/start/run-it/" },
            { label: "Your first board", link: "/start/first-board/" },
            { label: "Host it for your team", link: "/start/self-host/" },
            { label: "Configuration", link: "/start/configuration/" },
          ],
        },
        {
          label: "Using the board",
          items: [
            { label: "Properties", link: "/guides/properties/" },
            { label: "The card view", link: "/guides/card-view/" },
            { label: "Views", link: "/guides/views/" },
            { label: "The board", link: "/guides/board/" },
            { label: "The list", link: "/guides/list/" },
            { label: "Keyboard", link: "/guides/keyboard/" },
            { label: "Filters", link: "/guides/filters/" },
            { label: "Search", link: "/guides/search/" },
            { label: "The task panel", link: "/guides/task-panel/" },
            { label: "Settings", link: "/guides/settings/" },
            { label: "People and projects", link: "/guides/people/" },
          ],
        },
        {
          label: "Agents",
          items: [
            { label: "Agents on the board", link: "/agents/" },
            { label: "Connect an agent", link: "/agents/connect/" },
            { label: "The run protocol", link: "/agents/runs/" },
            { label: "Pause, stop, take over", link: "/agents/control/" },
            { label: "A worked example", link: "/agents/example/" },
            { label: "The Claude Code skill", link: "/agents/skill/" },
          ],
        },
        {
          label: "API reference",
          items: [
            { label: "Overview", link: "/api/" },
            { label: "Authentication", link: "/api/auth/" },
            { label: "Projects and people", link: "/api/projects/" },
            { label: "The board", link: "/api/board/" },
            { label: "Tasks", link: "/api/tasks/" },
            { label: "Properties and views", link: "/api/properties/" },
            { label: "Agents and runs", link: "/api/runs/" },
            { label: "Live events", link: "/api/events/" },
          ],
        },
        {
          label: "Under the bonnet",
          collapsed: true,
          items: [
            { label: "How it is built", link: "/internals/architecture/" },
            { label: "The data model", link: "/internals/data-model/" },
            { label: "Fractional ranks", link: "/internals/ranks/" },
            { label: "Contributing", link: "/internals/contributing/" },
            { label: "Security", link: "/internals/security/" },
          ],
        },
        {
          label: "Releases",
          items: [
            { label: "Changelog", link: "/releases/changelog/" },
            { label: "Roadmap", link: "/releases/roadmap/" },
          ],
        },
      ],
    }),
    sitemap(),
  ],
});
