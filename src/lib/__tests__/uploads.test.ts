import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../task-keys";
import {
  allowedVideoSrc,
  attachmentIdOf,
  insertLines,
  replaceFirst,
  uploadingLine,
  withoutUploadLines,
  type FileFacts,
} from "../uploads";

const ID = "0b6c3d8e-9a41-4f7e-8a39-2c1d5e6f7a80";
const OTHER = "5f0e4a2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const file = (mime: string, name = "shot.png", size = 2048): FileFacts => ({
  id: ID,
  name,
  mime,
  size,
});

describe("rendering a file by its mime", () => {
  it("draws an image as an image", () => {
    expect(renderMarkdown(`![shot.png](/api/attachments/${ID})`, null, [file("image/png")])).toBe(
      `<p><img src="/api/attachments/${ID}" alt="shot.png"></p>\n`,
    );
  });

  it("draws a video as a player that loads only its first frame", () => {
    expect(
      renderMarkdown(`![clip.mp4](/api/attachments/${ID})`, null, [file("video/mp4", "clip.mp4")]),
    ).toBe(
      `<p><video controls preload="metadata" src="/api/attachments/${ID}" title="clip.mp4"></video></p>\n`,
    );
  });

  it("draws any other mime as a link with the name and the size", () => {
    expect(
      renderMarkdown(`![plan.pdf](/api/attachments/${ID})`, null, [
        file("application/pdf", "plan.pdf", 3 * 1024 * 1024),
      ]),
    ).toBe(`<p><a href="/api/attachments/${ID}">plan.pdf (3 MiB)</a></p>\n`);
  });

  it("draws an SVG as a link, because it is not shown in place", () => {
    expect(
      renderMarkdown(`![logo.svg](/api/attachments/${ID})`, null, [
        file("image/svg+xml", "logo.svg", 900),
      ]),
    ).toBe(`<p><a href="/api/attachments/${ID}">logo.svg (900 bytes)</a></p>\n`);
  });

  it("learns the mime from the file list, not from the URL", () => {
    const text = `![clip.png](/api/attachments/${ID})`;
    expect(renderMarkdown(text, null, [file("video/mp4", "clip.png")])).toContain("<video");
    // A file the list does not hold is drawn as it was written.
    expect(renderMarkdown(text, null, [{ ...file("video/mp4"), id: OTHER }])).toBe(
      `<p><img src="/api/attachments/${ID}" alt="clip.png"></p>\n`,
    );
    expect(renderMarkdown(text)).toBe(`<p><img src="/api/attachments/${ID}" alt="clip.png"></p>\n`);
  });

  it("escapes the name it writes", () => {
    expect(
      renderMarkdown(`![x](/api/attachments/${ID})`, null, [
        file("application/zip", `<b>"a"&.zip`, 10),
      ]),
    ).toBe(
      `<p><a href="/api/attachments/${ID}">&lt;b&gt;&quot;a&quot;&amp;.zip (10 bytes)</a></p>\n`,
    );
  });

  it("still links the task keys around a file", () => {
    const links = { projectId: "p1", projectKey: "USH", keys: ["USH-12"] };
    expect(
      renderMarkdown(`![p](/api/attachments/${ID}) for USH-12`, links, [
        file("application/pdf", "p.pdf", 10),
      ]),
    ).toBe(
      `<p><a href="/api/attachments/${ID}">p.pdf (10 bytes)</a> for <a href="/p/p1?task=USH-12" data-task-key="USH-12">USH-12</a></p>\n`,
    );
  });
});

describe("attachmentIdOf", () => {
  it("reads the id of a file this board serves, and nothing else", () => {
    expect(attachmentIdOf(`/api/attachments/${ID}`)).toBe(ID);
    expect(attachmentIdOf(`https://evil.example/api/attachments/${ID}`)).toBeNull();
    expect(attachmentIdOf(`//evil.example/api/attachments/${ID}`)).toBeNull();
    expect(attachmentIdOf(`/api/attachments/${ID}/ready`)).toBeNull();
    expect(attachmentIdOf("/api/attachments/abc")).toBeNull();
  });
});

describe("allowedVideoSrc", () => {
  it("lets a player load only a file of this board", () => {
    expect(allowedVideoSrc(`/api/attachments/${ID}`)).toBe(true);
    expect(allowedVideoSrc("https://example.com/a.mp4")).toBe(false);
    expect(allowedVideoSrc(null)).toBe(false);
    expect(allowedVideoSrc("")).toBe(false);
  });
});

describe("the upload lines", () => {
  it("says the name and how far it is", () => {
    expect(uploadingLine("shot.png", 40)).toBe("Uploading shot.png… 40%");
  });

  it("puts each line on a line of its own at the cursor", () => {
    expect(insertLines("ab", 1, ["L1", "L2"])).toEqual({ text: "a\nL1\nL2\nb", caret: 8 });
    expect(insertLines("", 0, ["L1"])).toEqual({ text: "L1", caret: 2 });
    expect(insertLines("a\n", 2, ["L1"])).toEqual({ text: "a\nL1", caret: 4 });
    expect(insertLines("a\nb", 2, ["L1"])).toEqual({ text: "a\nL1\nb", caret: 5 });
  });

  it("replaces the first line that matches, or answers null when it is gone", () => {
    expect(replaceFirst("x\nA\nA", "A", "B")).toBe("x\nB\nA");
    expect(replaceFirst("x", "A", "B")).toBeNull();
  });
});

describe("withoutUploadLines", () => {
  it("takes every upload line out and leaves the rest as it was", () => {
    expect(withoutUploadLines("a\nUploading x.png… 5%")).toBe("a");
    expect(withoutUploadLines("Uploading x.png… 5%\nb")).toBe("b");
    expect(withoutUploadLines("a\nUploading x.png… 5%\nUploading y.mp4… 0%\nb")).toBe("a\nb");
    expect(withoutUploadLines("Uploading x.png… 100%")).toBe("");
    expect(withoutUploadLines("a\n")).toBe("a\n");
    expect(withoutUploadLines("Not Uploading x.png… 5% here")).toBe("Not Uploading x.png… 5% here");
  });
});
