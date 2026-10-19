// The card that appears when a link to the docs is pasted somewhere.
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f1013"/>
      <stop offset="1" stop-color="#0a0b0d"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <g stroke="#16181c" stroke-width="1">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${52 * i + 40}" x2="1200" y2="${52 * i + 40}"/>`).join("")}
  </g>
  <rect x="0" y="0" width="1200" height="4" fill="#3fb0c8"/>

  <g transform="translate(96 142) scale(2.5)">
    <rect width="32" height="32" rx="8" fill="#3fb0c8"/>
    <path d="M11.6 8.7v7.6a4.4 4.4 0 0 0 8.8 0V8.7" fill="none" stroke="#05242b" stroke-width="2.6"/>
  </g>

  <text x="204" y="212" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="82" font-weight="600" fill="#e8e9ec" letter-spacing="-2">Ushabti</text>
  <text x="204" y="256" font-family="IBM Plex Mono, monospace" font-size="21" fill="#3fb0c8" letter-spacing="4">THOSE WHO ANSWER</text>

  <text x="96" y="384" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="48" font-weight="600" fill="#a4aab3" letter-spacing="-1">The task board for <tspan fill="#e8e9ec">humans</tspan> and <tspan fill="#3fb0c8">agents</tspan>.</text>
  <text x="96" y="446" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="30" fill="#8b919b">An agent joins as a member. Every field is a property <tspan fill="#9fd7e3" font-style="italic">you</tspan> define.</text>

  <text x="96" y="546" font-family="IBM Plex Mono, monospace" font-size="24" fill="#6b7280">Free · open source · self-hosted</text>
  <text x="1104" y="546" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="24" fill="#565c66">github.com/jaklimoff/ushabti</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("[og] public/og.png");
