// Plain JavaScript, not TypeScript: `next start` reads this file at run time,
// and the production image installs no TypeScript compiler.
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["@dnd-kit/core", "@dnd-kit/sortable"],
  },
};

export default nextConfig;
