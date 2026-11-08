// Draws the promo from the take film.mjs left in scripts/promo/out, one frame
// at a time, and encodes it into the site's film and poster.
//
//   node scripts/promo/render.mjs              the whole film
//   node scripts/promo/render.mjs --at 9,18.5  only those moments, as JPEGs in out/check
//
// To watch it without encoding, serve scripts/promo and open index.html?play.
// It needs ffmpeg on the path (brew install ffmpeg).
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SITE = join(HERE, "..", "..", "website", "public");
const FPS = 30;
const POSTER_AT = 10; // "Humans and agents. Same board."
// A landing page that opens on a heavy film opens slowly.
const MAX_BYTES = 9 * 1024 * 1024;

if (!existsSync(join(OUT, "take.json"))) {
  console.error("There is no take. Run node scripts/promo/film.mjs first.");
  process.exit(1);
}
const take = JSON.parse(readFileSync(join(OUT, "take.json"), "utf8"));
writeFileSync(join(OUT, "take.js"), `window.TAKE = ${JSON.stringify(take)};\n`);

const at = process.argv[2] === "--at" ? process.argv[3].split(",").map(Number) : null;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".jsx": "text/babel",
  ".jpg": "image/jpeg",
};
const server = http
  .createServer((req, res) => {
    const file = join(HERE, decodeURIComponent(req.url.split("?")[0]));
    if (!file.startsWith(HERE) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  })
  .listen(0);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (err) => console.error("page:", err.message));
await page.goto(`http://localhost:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
const stage = page.locator("#stage");

async function frame(t, path, type) {
  await page.evaluate((t) => window.__seek(t), t);
  // The footage is images; a frame is not drawn until they are.
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((img) =>
        img.complete
          ? img.decode().catch(() => {})
          : new Promise((r) => {
              img.onload = img.onerror = r;
            }),
      ),
    ),
  );
  await stage.screenshot({ path, type, ...(type === "jpeg" ? { quality: 88 } : {}) });
}

if (at) {
  const dir = join(OUT, "check");
  mkdirSync(dir, { recursive: true });
  for (const t of at) await frame(t, join(dir, `t${t.toFixed(2)}.jpg`), "jpeg");
  console.log(`Wrote ${at.length} frames to ${dir}`);
} else {
  const total = await page.evaluate(() => window.__total);
  const dir = join(OUT, "render");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const count = Math.round(total * FPS);
  const started = Date.now();
  for (let i = 0; i < count; i += 1) {
    await frame(i / FPS, join(dir, `r${String(i).padStart(5, "0")}.png`), "png");
    if (i % 150 === 0)
      console.log(
        `${i} / ${count} frames, ${((Date.now() - started) / (i + 1)).toFixed(0)} ms each`,
      );
  }
  const film = join(SITE, "promo.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      join(dir, "r%05d.png"),
      "-c:v",
      "libx264",
      "-preset",
      "veryslow",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-tune",
      "animation",
      "-movflags",
      "+faststart",
      film,
    ],
    { stdio: "inherit" },
  );
  await sharp(join(dir, `r${String(POSTER_AT * FPS).padStart(5, "0")}.png`))
    .webp({ quality: 80 })
    .toFile(join(SITE, "promo-poster.webp"));
  const bytes = statSync(film).size;
  console.log(
    `Wrote ${film}: ${total.toFixed(1)} s, ${(bytes / 1024 / 1024).toFixed(1)} MB, and the poster`,
  );
  if (bytes >= MAX_BYTES) {
    console.error("The film has to stay under 9 MB.");
    process.exitCode = 1;
  }
}

await browser.close();
server.close();
