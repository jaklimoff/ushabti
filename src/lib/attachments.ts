/**
 * Files on a task, and what the environment says about them.
 *
 * The bytes live in an S3-compatible bucket and never pass through this
 * server: a person or an agent PUTs them to a presigned URL, says "ready",
 * and reads them back through `GET /api/attachments/{id}`, which checks the
 * project and redirects to a short signed URL. So the bucket is private, and
 * the one access rule is the one every other route already has: `guard()`.
 *
 * Like mail, it is set by the environment and off without it. Off, every
 * attachment route answers 503 with `ATTACHMENTS_OFF`.
 *
 * Everything here is pure, so a test reads every answer without a bucket.
 * `storage.ts` is the only module that speaks S3.
 */

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/* The size column is a Postgres integer. A cap above it would let a row
   promise a size the table cannot hold. */
const LARGEST_MAX_BYTES = 2_147_483_647;

export const DEFAULT_MIMES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
];

/** How long a presigned PUT works. */
export const UPLOAD_TTL_SECONDS = 10 * 60;
/** How long a presigned GET works. The link on the board is the lasting one. */
export const READ_TTL_SECONDS = 5 * 60;
/** An upload nobody confirmed in this long is removed, with its object. */
export const UNREADY_TTL_MS = 60 * 60 * 1000;

export const NAME_MAX = 200;

export const ATTACHMENTS_OFF = "Attachments are off, because this server has no S3 bucket set.";

/** What Settings → Project says while attachments are off. */
export const FILES_OFF_NOTE = "Set S3_BUCKET and its keys to let people attach files.";

export type AttachmentConfig =
  | {
      on: true;
      endpoint: string | null;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      forcePathStyle: boolean;
      maxBytes: number;
      mimes: string[];
    }
  /** `why` is the sentence the server logs once at start; null when nothing was asked for. */
  | { on: false; why: string | null };

type Env = Record<string, string | undefined>;

/** What the environment asks for. Read afresh, so a test drives every answer. */
export function attachmentConfig(env: Env = process.env): AttachmentConfig {
  const bucket = env.S3_BUCKET?.trim() ?? "";
  const accessKey = env.S3_ACCESS_KEY?.trim() ?? "";
  const secretKey = env.S3_SECRET_KEY?.trim() ?? "";
  if (!bucket) return { on: false, why: null };
  if (!accessKey || !secretKey) {
    return {
      on: false,
      why: "Attachments are off: S3_BUCKET is set, but S3_ACCESS_KEY or S3_SECRET_KEY is not.",
    };
  }
  return {
    on: true,
    endpoint: env.S3_ENDPOINT?.trim() || null,
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket,
    accessKey,
    secretKey,
    forcePathStyle: /^(1|true|yes)$/i.test(env.S3_FORCE_PATH_STYLE?.trim() ?? ""),
    maxBytes: readMaxBytes(env.ATTACHMENT_MAX_BYTES),
    mimes: readMimes(env.ATTACHMENT_MIMES),
  };
}

export function attachmentsOn(env: Env = process.env): boolean {
  return attachmentConfig(env).on;
}

function readMaxBytes(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (!/^\d+$/.test(text)) return DEFAULT_MAX_BYTES;
  const n = Number(text);
  if (n <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(n, LARGEST_MAX_BYTES);
}

function readMimes(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? [...new Set(list)] : DEFAULT_MIMES;
}

/**
 * What a browser may show in place. SVG is not an image here: it carries
 * script, and a script served from a URL somebody follows runs there.
 * Everything else is a download.
 */
export function isInline(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === "image/svg+xml") return false;
  return m.startsWith("image/") || m.startsWith("video/");
}

/** Whether this file is an image, which is what carries a width and a height. */
export function isImage(mime: string): boolean {
  return isInline(mime) && mime.toLowerCase().startsWith("image/");
}

/**
 * The image types whose bytes `imageSize` can read. An image of one of these
 * must be what it says; another image type a server adds to its list is
 * taken as it is, without a size.
 */
export const SIZED_IMAGES = ["image/png", "image/gif", "image/webp", "image/jpeg"];

export type UploadAsk = { name: string; mime: string; size: number };

/**
 * Reads what an upload asks for, or answers the sentence that refuses it.
 * The mime list and the cap are checked here, before a row is written.
 */
export function readUploadAsk(
  input: { name?: unknown; mime?: unknown; size?: unknown },
  config: { maxBytes: number; mimes: string[] },
): UploadAsk | { error: string } {
  if (typeof input.name !== "string" || !input.name.trim()) {
    return { error: "A file needs a name." };
  }
  const name = cleanName(input.name);
  if (name.length > NAME_MAX) return { error: `A file name is at most ${NAME_MAX} characters.` };
  if (typeof input.mime !== "string" || !input.mime.trim()) {
    return { error: "A file needs a mime type." };
  }
  const mime = input.mime.trim().toLowerCase();
  if (!config.mimes.includes(mime)) {
    return { error: `This board does not take ${mime} files.` };
  }
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { error: "A file needs its size in bytes." };
  }
  if (size > config.maxBytes) {
    return { error: `A file is at most ${formatBytes(config.maxBytes)}.` };
  }
  return { name, mime, size };
}

/* A name goes into a Content-Disposition header and into Markdown, so the
   characters that would break either are taken out. */
function cleanName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "_")
    .trim();
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 && n % (1024 * 1024) === 0) return `${n / (1024 * 1024)} MiB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KiB`;
  return `${n} bytes`;
}

/** The object key. It carries no name, so a name never reaches the bucket. */
export function objectKey(projectId: string, id: string): string {
  return `projects/${projectId}/${id}`;
}

/** What the presigned PUT is bound to: this object, this mime, this length. */
export function putInput(bucket: string, row: { key: string; mime: string; size: number }) {
  return { Bucket: bucket, Key: row.key, ContentType: row.mime, ContentLength: row.size };
}

/** The headers the uploader must send with the PUT. The length comes from the body. */
export function putHeaders(mime: string): Record<string, string> {
  return { "Content-Type": mime };
}

/** What the presigned GET answers with: the stored mime, inline or a download. */
export function getInput(bucket: string, row: { key: string; mime: string; name: string }) {
  return {
    Bucket: bucket,
    Key: row.key,
    ResponseContentType: row.mime,
    ResponseContentDisposition: disposition(row.mime, row.name),
  };
}

export function disposition(mime: string, name: string): string {
  const kind = isInline(mime) ? "inline" : "attachment";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The Markdown line that shows a file, as an agent pastes it. */
export function markdownLine(id: string, name: string): string {
  const label = name.replace(/[[\]]/g, "");
  return `![${label}](/api/attachments/${id})`;
}

/** How many bytes from the start of an image `imageSize` needs at most. */
export const IMAGE_HEAD_BYTES = 256 * 1024;

/**
 * The width and height of an image, read from its first bytes, or null when
 * they are not the image the mime says. PNG, GIF, WebP and JPEG; anything
 * else answers null, which the ready route reads as "not that image". A JPEG
 * may carry more metadata before its frame than the bytes read: it is still
 * a JPEG, so its size is unknown rather than refused.
 */
export function imageSize(
  mime: string,
  bytes: Uint8Array,
): { width: number | null; height: number | null } | null {
  const b = bytes;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  const sized = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;

  switch (mime.toLowerCase()) {
    case "image/png":
      if (b.length < 24 || u32be(0) !== 0x89504e47 || ascii(12, 4) !== "IHDR") return null;
      return sized(u32be(16), u32be(20));
    case "image/gif":
      if (b.length < 10 || !/^GIF8[79]a$/.test(ascii(0, 6))) return null;
      return sized(u16le(6), u16le(8));
    case "image/webp": {
      if (b.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;
      const chunk = ascii(12, 4);
      if (chunk === "VP8 ") return sized(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
      if (chunk === "VP8L") {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (chunk === "VP8X") return sized(u24le(24) + 1, u24le(27) + 1);
      return null;
    }
    case "image/jpeg": {
      if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        // Fill bytes before a marker.
        if (marker === 0xff) {
          i += 1;
          continue;
        }
        // A start of frame carries the size; DHT, JPG and DAC share the range.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return sized(u16be(i + 7), u16be(i + 5));
        }
        i += 2 + u16be(i + 2);
      }
      return { width: null, height: null };
    }
    default:
      return null;
  }
}
