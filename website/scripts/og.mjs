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

  <g transform="translate(96 150) scale(3.1)">
    <path d="M12 1.6c2.98 0 5.2 2.3 5.2 5.28V9.5l1.2 9.4c.22 1.72-1.02 3.5-2.72 3.5H8.32c-1.7 0-2.94-1.78-2.72-3.5l1.2-9.4V6.88C6.8 3.9 9.02 1.6 12 1.6Z"
      fill="rgba(63,176,200,0.14)" stroke="#e8e9ec" stroke-width="1.35" stroke-linejoin="round"/>
    <path d="M8.5 11.6 15.5 15.1M15.5 11.6 8.5 15.1" stroke="#3fb0c8" stroke-width="1.5" stroke-linecap="round"/>
  </g>

  <text x="200" y="212" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="82" font-weight="600" fill="#e8e9ec" letter-spacing="-2">Ushabti</text>
  <text x="200" y="256" font-family="IBM Plex Mono, monospace" font-size="21" fill="#3fb0c8" letter-spacing="4">THOSE WHO ANSWER</text>

  <text x="96" y="384" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="42" font-weight="500" fill="#cdd2d9">A small, fast task board where every field</text>
  <text x="96" y="440" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="42" font-weight="500" fill="#cdd2d9">on a task is a property <tspan fill="#9fd7e3" font-style="italic">you</tspan> define.</text>

  <text x="96" y="546" font-family="IBM Plex Mono, monospace" font-size="24" fill="#6b7280">Free · open source · agents welcome</text>
  <text x="1104" y="546" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="24" fill="#565c66">github.com/jaklimoff/ushabti</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(out);
console.log("[og] public/og.png");
