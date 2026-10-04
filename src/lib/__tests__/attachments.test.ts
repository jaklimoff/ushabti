import { describe, expect, it } from "vitest";
import {
  attachmentConfig,
  attachmentsOn,
  DEFAULT_MAX_BYTES,
  DEFAULT_MIMES,
  disposition,
  getInput,
  imageSize,
  isImage,
  isInline,
  markdownLine,
  objectKey,
  putHeaders,
  putInput,
  readUploadAsk,
} from "@/lib/attachments";

const BUCKET = { S3_BUCKET: "ushabti", S3_ACCESS_KEY: "key", S3_SECRET_KEY: "secret" };

describe("attachmentConfig", () => {
  it("is off with no bucket, and says nothing then", () => {
    expect(attachmentConfig({})).toEqual({ on: false, why: null });
    expect(attachmentsOn({ S3_ACCESS_KEY: "key", S3_SECRET_KEY: "secret" })).toBe(false);
  });

  it("is off with a bucket and no keys, and says why", () => {
    const config = attachmentConfig({ S3_BUCKET: "ushabti" });
    expect(config.on).toBe(false);
    expect(!config.on && config.why).toMatch(/S3_ACCESS_KEY/);
  });

  it("takes the defaults: 50 MiB and images and video", () => {
    const config = attachmentConfig(BUCKET);
    expect(config).toMatchObject({
      on: true,
      endpoint: null,
      region: "us-east-1",
      forcePathStyle: false,
      maxBytes: 50 * 1024 * 1024,
      mimes: ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm"],
    });
  });

  it("reads the endpoint, the path style, the cap and the mime list", () => {
    const config = attachmentConfig({
      ...BUCKET,
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "ams3",
      S3_FORCE_PATH_STYLE: "true",
      ATTACHMENT_MAX_BYTES: "1024",
      ATTACHMENT_MIMES: " image/PNG , application/pdf,,",
    });
    expect(config).toMatchObject({
      endpoint: "http://minio:9000",
      region: "ams3",
      forcePathStyle: true,
      maxBytes: 1024,
      mimes: ["image/png", "application/pdf"],
    });
  });

  it("falls back to the default cap for a cap that is not a number", () => {
    for (const raw of ["", "abc", "-5", "0", "1.5"]) {
      const config = attachmentConfig({ ...BUCKET, ATTACHMENT_MAX_BYTES: raw });
      expect(config.on && config.maxBytes).toBe(DEFAULT_MAX_BYTES);
    }
  });
});

describe("readUploadAsk", () => {
  const config = { maxBytes: 1000, mimes: DEFAULT_MIMES };

  it("takes a file on the list and under the cap", () => {
    expect(readUploadAsk({ name: " shot.png ", mime: "IMAGE/PNG", size: 1000 }, config)).toEqual({
      name: "shot.png",
      mime: "image/png",
      size: 1000,
    });
  });

  it("refuses a mime off the list", () => {
    const answer = readUploadAsk({ name: "a.pdf", mime: "application/pdf", size: 10 }, config);
    expect(answer).toEqual({ error: "This board does not take application/pdf files." });
  });

  it("refuses SVG by default", () => {
    const answer = readUploadAsk({ name: "a.svg", mime: "image/svg+xml", size: 10 }, config);
    expect("error" in answer).toBe(true);
  });

  it("refuses a file over the cap", () => {
    const answer = readUploadAsk({ name: "a.png", mime: "image/png", size: 1001 }, config);
    expect(answer).toEqual({ error: "A file is at most 1000 bytes." });
  });

  it("refuses a missing name, mime or size", () => {
    expect("error" in readUploadAsk({ mime: "image/png", size: 1 }, config)).toBe(true);
    expect("error" in readUploadAsk({ name: "a", size: 1 }, config)).toBe(true);
    expect("error" in readUploadAsk({ name: "a", mime: "image/png" }, config)).toBe(true);
    expect("error" in readUploadAsk({ name: "a", mime: "image/png", size: 0 }, config)).toBe(true);
    expect("error" in readUploadAsk({ name: "a", mime: "image/png", size: 1.5 }, config)).toBe(
      true,
    );
  });

  it("takes slashes and control characters out of a name", () => {
    const answer = readUploadAsk({ name: "../a\nb.png", mime: "image/png", size: 1 }, config);
    expect(answer).toMatchObject({ name: ".._ab.png" });
  });
});

describe("inline or a download", () => {
  it("shows an image or a video in place", () => {
    for (const mime of ["image/png", "image/webp", "video/mp4"]) expect(isInline(mime)).toBe(true);
  });

  it("never shows SVG in place, because it carries script", () => {
    expect(isInline("image/svg+xml")).toBe(false);
    expect(isImage("image/svg+xml")).toBe(false);
    expect(disposition("image/svg+xml", "logo.svg")).toMatch(/^attachment;/);
  });

  it("downloads anything that is not an image or a video", () => {
    expect(isInline("application/pdf")).toBe(false);
    expect(isInline("text/html")).toBe(false);
    expect(disposition("text/html", "page.html")).toMatch(/^attachment;/);
  });

  it("names the file in plain ASCII and in UTF-8", () => {
    expect(disposition("image/png", 'Ünï "x".png')).toBe(
      `inline; filename="_n_ _x_.png"; filename*=UTF-8''%C3%9Cn%C3%AF%20%22x%22.png`,
    );
  });
});

describe("presign inputs", () => {
  const row = { key: objectKey("p1", "a1"), mime: "image/png", size: 42, name: "a.png" };

  it("keys an object by project and id, never by name", () => {
    expect(row.key).toBe("projects/p1/a1");
  });

  it("binds the PUT to the key, the mime and the length", () => {
    expect(putInput("b", row)).toEqual({
      Bucket: "b",
      Key: "projects/p1/a1",
      ContentType: "image/png",
      ContentLength: 42,
    });
    expect(putHeaders("image/png")).toEqual({ "Content-Type": "image/png" });
  });

  it("answers the GET with the stored mime and the disposition", () => {
    expect(getInput("b", { ...row, mime: "image/svg+xml", name: "x.svg" })).toEqual({
      Bucket: "b",
      Key: "projects/p1/a1",
      ResponseContentType: "image/svg+xml",
      ResponseContentDisposition: `attachment; filename="x.svg"; filename*=UTF-8''x.svg`,
    });
  });

  it("writes the Markdown line an agent pastes", () => {
    expect(markdownLine("a1", "shot [1].png")).toBe("![shot 1.png](/api/attachments/a1)");
  });
});

describe("imageSize", () => {
  const bytes = (...parts: Array<number[] | string>) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  it("reads a PNG", () => {
    const png = bytes([0x89], "PNG", [13, 10, 26, 10], u32(13), "IHDR", u32(640), u32(480));
    expect(imageSize("image/png", png)).toEqual({ width: 640, height: 480 });
  });

  it("reads a GIF", () => {
    expect(imageSize("image/gif", bytes("GIF89a", [0x20, 0x03, 0x58, 0x02]))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("reads a JPEG past an APP0 segment", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00],
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03],
    );
    expect(imageSize("image/jpeg", jpeg)).toEqual({ width: 400, height: 300 });
  });

  it("knows a JPEG whose frame lies past the bytes read, and leaves its size unknown", () => {
    const jpeg = bytes([0xff, 0xd8], [0xff, 0xe1, 0xff, 0xff], new Array(64).fill(0));
    expect(imageSize("image/jpeg", jpeg)).toEqual({ width: null, height: null });
  });

  it("reads a WebP of each kind", () => {
    const head = (chunk: string) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0]);
    const vp8x = new Uint8Array([...head("VP8X"), 0, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
    expect(imageSize("image/webp", vp8x)).toEqual({ width: 100, height: 50 });
    const lossy = new Uint8Array([...head("VP8 "), 0, 0, 0, 0x9d, 0x01, 0x2a, 64, 0, 32, 0]);
    expect(imageSize("image/webp", lossy)).toEqual({ width: 64, height: 32 });
    // 15 and 7, stored less one, in 14 bits each.
    const bits = 14 | (6 << 14);
    const lossless = new Uint8Array([
      ...head("VP8L"),
      0x2f,
      bits & 255,
      (bits >> 8) & 255,
      (bits >> 16) & 255,
      (bits >> 24) & 255,
      ...new Array(5).fill(0),
    ]);
    expect(imageSize("image/webp", lossless)).toEqual({ width: 15, height: 7 });
  });

  it("answers null for bytes that are not the image the mime says", () => {
    expect(imageSize("image/png", bytes("<html><script>"))).toBeNull();
    expect(imageSize("image/jpeg", bytes("GIF89a", [1, 0, 1, 0]))).toBeNull();
    expect(imageSize("image/svg+xml", bytes("<svg></svg>"))).toBeNull();
  });
});
