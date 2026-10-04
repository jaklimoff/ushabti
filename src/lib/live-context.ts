import type { PreviewContext } from "./live-markdown";
import { keyLinksIn, type TaskLinks } from "./task-keys";
import { attachmentIdOf, lookOf, type FileFacts } from "./uploads";

/**
 * What the live box asks the page: how a file is drawn and which keys are
 * links. The answers are the page's own rules, so the box cannot read a file
 * or a key another way.
 *
 * It is built on the board's side and handed to the editor, because the
 * editor is a chunk of its own: importing these rules from there moves them
 * into one more chunk that the board page has to fetch.
 */
export function previewContextFor(
  files: readonly FileFacts[],
  links: TaskLinks | null,
): PreviewContext {
  return {
    fileAt: (src) => {
      const id = attachmentIdOf(src)?.toLowerCase();
      // Only a file of this board is fetched. Any other address stays words.
      if (!id) return null;
      const file = files.find((f) => f.id.toLowerCase() === id);
      // A file the list does not hold yet is the image marked draws.
      return file ? lookOf(file) : { kind: "image" };
    },
    keysIn: (text) => (links ? keyLinksIn(text, links) : []),
  };
}
