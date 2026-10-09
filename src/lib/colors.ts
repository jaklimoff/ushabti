/** The palette of the design. Every option and avatar picks from this list. */
export const PALETTE = [
  "#e0574d",
  "#d1913a",
  "#4f8a5b",
  "#3fb0c8",
  "#4b8fbe",
  "#6d5bd0",
  "#c2557a",
  "#b6763f",
  "#2f9e7a",
  "#7a8a2f",
  "#3d7fc1",
  "#8b8f98",
] as const;

/** The grey of the palette. On an avatar it reads as nobody, so no person wears it. */
const NOBODY = "#8b8f98";

/**
 * The colours a person may wear: the whole palette but the grey. Eight used to
 * be too few, and on a team of six two people often wore the same one. The
 * account route and the swatches both read this list.
 */
export const AVATAR_COLORS: readonly string[] = PALETTE.filter((c) => c !== NOBODY);

export function pickAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * The colours a project may wear, behind its key in dark ink. Lighter than
 * the palette above, so the key keeps WCAG AA on every one and the square
 * still reads on the dark theme. Migration 0032 copied this list to colour
 * the projects that were already there; `project-color.test.ts` holds the two
 * together.
 */
export const PROJECT_COLORS = [
  "#f08a7e",
  "#f0a860",
  "#e3c55a",
  "#b5cf66",
  "#7cc48a",
  "#5cc5b0",
  "#63c3dc",
  "#7aa8f0",
  "#a99af0",
  "#ec8fb8",
] as const;

/** The ink of a project's key. Dark on every project colour, so it never flips. */
export const PROJECT_INK = "#14161a";

/**
 * The colour a new project starts with, picked from its key. Keys made one
 * after another tend to differ in their last letter, and the last letter moves
 * the pick by one, so neighbours rarely match. The migration does the same sum
 * in SQL: walk the key by code point, never by UTF-16 unit.
 */
export function pickProjectColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) % PROJECT_COLORS.length;
  return PROJECT_COLORS[h];
}

export function nextPaletteColor(used: string[]): string {
  const free = PALETTE.find((c) => !used.includes(c));
  return free ?? PALETTE[used.length % PALETTE.length];
}

function channels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
}

/** Translates #rrggbb into an rgba() string with the given alpha. */
export function tint(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DARK_INK = "#14161a";
const LIGHT_INK = "#f6f8fa";

/** The card the faces sit on. The app has one theme, so this is `--bg-card`. */
const CARD = "#14171b";

/** The lightness APCA reads, with its soft clamp for near black. */
function apcaY(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c / 255) ** 2.4);
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
}

/** APCA's lightness contrast (Lc) of text on a ground, without its sign. */
function contrast(text: string, ground: string): number {
  const t = apcaY(text);
  const g = apcaY(ground);
  const s = g > t ? (g ** 0.56 - t ** 0.57) * 1.14 : (g ** 0.65 - t ** 0.62) * 1.14;
  return Math.abs(s) < 0.1 ? 0 : (Math.abs(s) - 0.027) * 100;
}

/**
 * The ink that reads on a colour: avatars, the agent badge, the swatches and
 * filled chips all ask this one rule. The palette is mid-tone, and WCAG 2's
 * luminance sum picks dark ink on nearly all of it, which reads badly on pink
 * and violet. APCA weighs light text on a mid ground as the eye does.
 */
export function ink(hex: string): string {
  return contrast(DARK_INK, hex) > contrast(LIGHT_INK, hex) ? DARK_INK : LIGHT_INK;
}

/**
 * The ground an emoji face sits on: a quarter of its colour over the card. An
 * emoji carries its own colours, and on the full fill a frog on green or fire
 * on red disappears.
 */
export function emojiGround(hex: string): string {
  const over = channels(CARD);
  return `#${channels(hex)
    .map((c, i) =>
      Math.round(c * 0.25 + over[i] * 0.75)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * How a face is painted. Initials and the ◆ take the full colour; an emoji
 * takes the dark ground with a thin ring of the colour, so the face still says
 * whose it is. The avatar and the swatches both ask this.
 */
export function facePaint(
  color: string,
  wearsEmoji: boolean,
): { background: string; color: string; boxShadow?: string } {
  if (!wearsEmoji) return { background: color, color: ink(color) };
  const ground = emojiGround(color);
  return { background: ground, color: ink(ground), boxShadow: `inset 0 0 0 1px ${color}` };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
