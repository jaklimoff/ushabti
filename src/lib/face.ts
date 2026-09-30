import { HttpError } from "@/lib/auth";
import { str } from "@/lib/api";
import { AVATAR_COLORS } from "@/lib/colors";
import { isOneEmoji } from "@/lib/emoji";

/**
 * The colour and the emoji a face wears, read from a request. A person sets
 * their own on the account route and an admin sets an agent's on the agent
 * route, so both read this one, and a face that one route takes the other
 * takes too. `plain` names what null draws: initials for a person, ◆ for an
 * agent.
 */
export function readFace(
  input: { color?: unknown; emoji?: unknown },
  plain: string,
): { color?: string; avatarEmoji?: string | null } {
  const patch: { color?: string; avatarEmoji?: string | null } = {};

  if (input.color !== undefined) {
    const color = str(input.color, "Colour", { max: 7 }).toLowerCase();
    // The palette is the palette. A free colour picker is how the board ends
    // up with a person nobody can see against the background.
    if (!AVATAR_COLORS.includes(color)) {
      throw new HttpError(400, "Pick one of the colours on offer.");
    }
    patch.color = color;
  }

  if (input.emoji !== undefined) {
    // The grid offers about thirty, but any one emoji is a face. Two are a
    // word, and a letter is what the initials already are.
    if (input.emoji !== null && (typeof input.emoji !== "string" || !isOneEmoji(input.emoji))) {
      throw new HttpError(400, `A face is one emoji, or null for ${plain}.`);
    }
    patch.avatarEmoji = input.emoji;
  }

  return patch;
}
