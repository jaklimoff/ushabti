/**
 * One emoji, whole, as Unicode lists it: a picture with its skin tone or
 * variation selector, a ZWJ sequence, a flag, a subdivision flag or a keycap.
 * Nothing more, so "ab", "😀😀", "©", "🇦🇦" and "" are all refused. The
 * account route reads it for a person's face and the agent route will read
 * the same one.
 *
 * Unicode also lists a skin tone alone. It is only a part of a face, so it is
 * refused here.
 */
const LONE_TONE = /^\p{Emoji_Modifier}$/u;

/** The longest ZWJ sequence in use is well under this. It keeps a column short. */
const MAX_LENGTH = 32;

/* Built on first use and not on load: the Account page imports this file for
   the grid, and a browser without the v flag must still draw it. */
let oneEmoji: RegExp | null = null;

export function isOneEmoji(text: string): boolean {
  oneEmoji ??= new RegExp("^\\p{RGI_Emoji}$", "v");
  return text.length <= MAX_LENGTH && oneEmoji.test(text) && !LONE_TONE.test(text);
}

/**
 * The faces the Account page offers. The route takes any one emoji, so a face
 * set through the API that is not here still shows as picked.
 */
export const FACE_EMOJI: readonly string[] = [
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐸",
  "🐙",
  "🦉",
  "🐝",
  "🦄",
  "🐢",
  "🐳",
  "🦕",
  "🌵",
  "🌻",
  "🍄",
  "🌙",
  "⭐",
  "🔥",
  "⚡",
  "🌊",
  "🍋",
  "🍉",
  "🍩",
  "☕",
  "🎸",
  "🚀",
  "👾",
];
