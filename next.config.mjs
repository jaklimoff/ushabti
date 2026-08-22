// Plain JavaScript, not TypeScript: `next start` reads this file at run time,
// and the production image installs no TypeScript compiler.
/** @type {import("next").NextConfig} */
const nextConfig = {
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
