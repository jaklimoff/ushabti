// Plain JavaScript, not TypeScript: a `.ts` config has to be compiled before
// the build or `next dev` can read it, and the JSDoc line below already gives
// the checking. Production reads no config file at all — `next build` writes
// these values into `.next/standalone/server.js`, which is what runs.

// The dev server allows localhost and the name it was started with, and blocks
// its own HMR for any other name. A dev server reached as `mini-m4.local` logs
// "Blocked cross-origin request", the client never hydrates, and the login form
// posts as plain HTML with no error on screen. So the hosts come from the
// environment: a name here would be tracked, and a mounted file went stale
// every time git rewrote this one. Only `next dev` reads the key.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Unset or empty leaves the key off, so the default stands.
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  reactStrictMode: true,
  // The image runs `.next/standalone/server.js`. Next traces which files the
  // server really touches and copies them, so the runner stage installs no
  // packages at all. Without this the image carries the whole dependency tree.
  output: "standalone",
  // `scripts/migrate.mjs` runs before the server on every start, so nothing in
  // the app imports it and the tracer never sees it. These lines put it, the SQL
  // it applies and the package it loads into the traced output by hand.
  //
  // The whole of `drizzle-orm` goes in, not only `node-postgres`. The migrator
  // is resolved at run time, not bundled, so it needs the package.json of the
  // package to read its `exports` map, and it then reaches back into the rest
  // of the package. 16 MB is a small price for a start that cannot fail.
  //
  // `examples/skill/ushabti` is the same story: /skill/[file] reads those two
  // files off disk so the settings page can hand somebody a working install
  // command, and nothing imports them either.
  outputFileTracingIncludes: {
    "/**": [
      "./scripts/migrate.mjs",
      "./drizzle/**",
      "./node_modules/drizzle-orm/**",
      "./examples/skill/ushabti/**",
    ],
  },
  experimental: {
    optimizePackageImports: ["@dnd-kit/core", "@dnd-kit/sortable"],
  },
};

export default nextConfig;
